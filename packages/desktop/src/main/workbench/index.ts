export * as Workbench from "./index"

import { Context, Effect, Layer } from "effect"
import { parseRichText } from "@opencode/util/rich-text"
import { DesktopStorage } from "../storage"
import * as Settings from "./settings"
import * as Tasks from "./tasks"
import * as Yunxiao from "./yunxiao"

/**
 * The workbench snapshot is assembled in the main process: the renderer never sees the token, and
 * every window shares one cache instead of hammering the agent API on each remount.
 */

const CACHE_MS = 60_000

export type Snapshot = {
  serverUrl: string
  fetchedAt: number
  token: { configured: boolean; source: "env" | "stored" | "none"; userName?: string }
  // 云效工作流状态清单（frontend-server 聚合），决定顶部 Tab 与“全部”里出现哪些任务。
  statuses: string[]
  items: Yunxiao.Item[]
  counts: { total: number; ready: number; clarify: number; blocked: number }
  warnings: string[]
  error?: string
}

export type DetailContext = {
  item: Yunxiao.Item
  // 正文保留纯文本用于兜底与搜索，HTML 用于还原云效富文本排版。
  description: string
  descriptionHtml: string
  comments: Array<{ author: string; created?: string; content: string; contentHtml: string }>
}

export type Detail = DetailContext & {
  attachments: Array<{ name: string; url?: string }>
  relations: Array<{ serial: string; title: string; statusName?: string; relation: string }>
  parent?: DetailContext
  children: DetailContext[]
  linked: DetailContext[]
  activities: Array<{ author: string; action: string; created?: string }>
}

export type Interface = {
  state(input?: { force?: boolean }): Promise<Snapshot>
  item(id: string, config?: Yunxiao.ContextConfig, force?: boolean): Promise<Detail>
  setToken(token: string): Promise<Snapshot>
  setSettings(input: { frontendServerUrl: string; organizationId?: string }): Promise<Snapshot>
  preflight(directory: string): Promise<Tasks.Preflight>
  tasks(): { tasks: Tasks.Task[]; runs: Tasks.TaskRun[] }
  taskStart(input: Tasks.TaskInput & { directory: string }): Promise<Tasks.Task>
  taskSetStage(input: { id: string; stage: Tasks.TaskStage; summary?: string }): Promise<Tasks.Task>
  taskBindRun(input: {
    taskId: string
    sessionId: string
    kind: string
    stage?: Tasks.TaskStage
  }): Promise<Tasks.TaskRun>
  taskApprove(id: string): Promise<Tasks.Task>
  taskDocs(id: string): Promise<Tasks.TaskDocs>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Workbench") {}

function empty(warnings: string[] = [], error?: string): Snapshot {
  return {
    serverUrl: Settings.DEFAULT_SERVER_URL,
    fetchedAt: Date.now(),
    token: { configured: false, source: "none" },
    statuses: [],
    items: [],
    counts: { total: 0, ready: 0, clarify: 0, blocked: 0 },
    warnings,
    error,
  }
}

function detailContext(client: Yunxiao.Client, context: Yunxiao.RawContext, force?: boolean): Promise<DetailContext> {
  const description = parseRichText(context.description)
  const workItemId = context.workItem.id

  return Yunxiao.inlineImages(client, workItemId, description.html, { refresh: force }).then(
    async (descriptionHtml) => ({
      item: Yunxiao.toItem(context.workItem),
      description: description.text,
      descriptionHtml,
      comments: await Promise.all(
        (context.comments ?? []).map(async (comment) => {
          const parsed = parseRichText(comment.content)

          return {
            author: comment.creatorName ?? "未知",
            created: comment.gmtCreate,
            content: parsed.text,
            contentHtml: await Yunxiao.inlineImages(client, workItemId, parsed.html),
          }
        }),
      ),
    }),
  )
}

// 云效的 actionType 是英文枚举，落到界面上换成中文动词。
const ACTIVITY_ACTIONS: Record<string, string> = {
  create: "创建",
  update: "更新",
  delete: "删除",
  relate: "关联",
  unrelate: "取消关联",
  comment: "评论",
  move: "流转",
  attach: "添加附件",
}

// 变更记录压成一句话：动作 + 字段 + 新值，够看谁在什么时候改了什么。
function activityAction(activity: NonNullable<Yunxiao.RawContext["activities"]>[number]) {
  const next = (activity.newValue ?? [])
    .map((value) => value.displayValue)
    .filter((value): value is string => Boolean(value))
    .join("、")
  const action = ACTIVITY_ACTIONS[activity.actionType ?? ""] ?? activity.actionType
  const label = [action, activity.propertyName].filter(Boolean).join(" ")

  if (!next) return label || "更新"

  return `${label || "更新"}：${next}`
}

function make(storage: DesktopStorage.Interface) {
  const tasks = Tasks.createTaskStore(storage.db)
  let cache: { at: number; snapshot: Snapshot } | undefined
  let inflight: Promise<Snapshot> | undefined

  const state = storage.state

  async function refresh(): Promise<Snapshot> {
    const settings = Settings.readSettings(state)
    const token = Settings.resolveToken()

    if (!token.value) {
      return {
        ...empty(["未找到云效令牌：在设置里粘贴，或在 shell 里 export YUNXIAO_ACCESS_TOKEN"]),
        serverUrl: settings.frontendServerUrl,
      }
    }

    const client = {
      baseUrl: settings.frontendServerUrl.replace(/\/$/, ""),
      token: token.value,
      organizationId: Settings.resolveOrganizationId(settings),
    }
    const warnings: string[] = []

    try {
      const me = await Yunxiao.user(client)
      // 状态清单失败不应让工作项一起消失：记一条警告，Tab 退回工作项里实际存在的状态。
      const [items, statuses] = await Promise.all([
        Yunxiao.collect(client, me.user.id, (message) => warnings.push(message)).then(Yunxiao.sort),
        Yunxiao.statuses(client).catch((cause) => {
          warnings.push(
            `云效状态清单拉取失败：${cause instanceof Error ? cause.message : String(cause)}；筛选只显示工作项已有状态`,
          )

          return []
        }),
      ])
      const snapshot: Snapshot = {
        serverUrl: client.baseUrl,
        fetchedAt: Date.now(),
        token: { configured: true, source: token.source, userName: me.user.name },
        statuses,
        items,
        counts: {
          total: items.length,
          ready: items.filter((item) => item.readiness === "ready").length,
          clarify: items.filter((item) => item.readiness === "clarify").length,
          blocked: items.filter((item) => item.readiness === "blocked").length,
        },
        warnings,
      }

      return snapshot
    } catch (error) {
      return {
        ...empty(
          warnings,
          `云效读取失败：${error instanceof Error ? error.message : String(error)}（检查 frontend-server 是否在 ${client.baseUrl}）`,
        ),
        serverUrl: client.baseUrl,
        token: { configured: true, source: token.source },
      }
    }
  }

  const api: Interface = {
    async state(input) {
      if (!input?.force && cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot
      if (inflight) return inflight

      inflight = refresh()
        .then((snapshot) => {
          // A failed refresh keeps the previous list visible instead of blanking the view.
          if (snapshot.error && cache) return { ...cache.snapshot, error: snapshot.error, warnings: snapshot.warnings }
          cache = { at: Date.now(), snapshot }
          return snapshot
        })
        .finally(() => {
          inflight = undefined
        })

      return inflight
    },

    async item(id, config, force) {
      const settings = Settings.readSettings(state)
      const token = Settings.resolveToken()

      if (!token.value) throw new Error("未配置云效令牌")

      const client = {
        baseUrl: settings.frontendServerUrl.replace(/\/$/, ""),
        token: token.value,
        organizationId: Settings.resolveOrganizationId(settings),
      }
      const result = await Yunxiao.context(client, id, config ?? Yunxiao.DEFAULT_CONTEXT_CONFIG)
      const context = result.context
      const describe = (target: Yunxiao.RawContext): Promise<DetailContext> => detailContext(client, target, force)

      return {
        ...(await describe(context)),
        attachments: (context.attachments ?? [])
          .map((file) => ({ name: file.fileName ?? file.name ?? "", url: file.url ?? file.downloadUrl }))
          .filter((file) => file.name),
        relations: (context.relations ?? [])
          .filter((relation) => relation.relatedWorkItem?.serialNumber)
          .map((relation) => ({
            serial: relation.relatedWorkItem?.serialNumber ?? "",
            title: relation.relatedWorkItem?.subject ?? "",
            statusName: relation.relatedWorkItem?.statusName,
            relation: relation.relationType ?? "",
          })),
        parent: context.parentContext ? await describe(context.parentContext) : undefined,
        children: await Promise.all((context.childContexts ?? []).map(describe)),
        linked: await Promise.all((context.linkedContexts ?? []).map(describe)),
        activities: (context.activities ?? []).map((activity) => ({
          author: activity.operatorName ?? "未知",
          action: activityAction(activity),
          created: activity.eventTime,
        })),
      }
    },

    async setToken(token) {
      Settings.writeStored(token.trim())
      cache = undefined
      Yunxiao.clearAssets()
      return api.state({ force: true })
    },

    async setSettings(input) {
      Settings.writeSettings(state, {
        frontendServerUrl: input.frontendServerUrl.trim() || Settings.DEFAULT_SERVER_URL,
        organizationId: input.organizationId?.trim() || undefined,
      })
      cache = undefined
      Yunxiao.clearAssets()
      return api.state({ force: true })
    },

    preflight: tasks.preflight,
    tasks: tasks.list,
    taskStart: tasks.start,
    taskSetStage: (input) => tasks.setStage(input.id, input.stage, input.summary),
    taskBindRun: tasks.bindRun,
    taskApprove: tasks.approve,
    taskDocs: tasks.docs,
  }

  return api
}

export const layer = Layer.effect(
  Service,
  Effect.map(DesktopStorage.Service, (storage) => Service.of(make(storage))),
)
