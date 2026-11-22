export * as Workbench from "./index"

import { Context, Effect, Layer } from "effect"
import { DesktopStorage } from "../storage"
import * as Settings from "./settings"
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
  items: Yunxiao.Item[]
  counts: { total: number; ready: number; clarify: number; blocked: number }
  warnings: string[]
  error?: string
}

export type Detail = {
  item: Yunxiao.Item
  description: string
  comments: Array<{ author: string; created?: string; content: string }>
  attachments: Array<{ name: string; url?: string }>
  relations: Array<{ serial: string; title: string; statusName?: string; relation: string }>
}

export type Interface = {
  state(input?: { force?: boolean }): Promise<Snapshot>
  item(id: string): Promise<Detail>
  setToken(token: string): Promise<Snapshot>
  setSettings(input: { frontendServerUrl: string; organizationId?: string }): Promise<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Workbench") {}

function empty(warnings: string[] = [], error?: string): Snapshot {
  return {
    serverUrl: Settings.DEFAULT_SERVER_URL,
    fetchedAt: Date.now(),
    token: { configured: false, source: "none" },
    items: [],
    counts: { total: 0, ready: 0, clarify: 0, blocked: 0 },
    warnings,
    error,
  }
}

function make(storage: DesktopStorage.Interface) {
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
      const items = Yunxiao.sort(await Yunxiao.collect(client, me.user.id, (message) => warnings.push(message)))
      const snapshot: Snapshot = {
        serverUrl: client.baseUrl,
        fetchedAt: Date.now(),
        token: { configured: true, source: token.source, userName: me.user.name },
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

    async item(id) {
      const settings = Settings.readSettings(state)
      const token = Settings.resolveToken()

      if (!token.value) throw new Error("未配置云效令牌")

      const client = {
        baseUrl: settings.frontendServerUrl.replace(/\/$/, ""),
        token: token.value,
        organizationId: Settings.resolveOrganizationId(settings),
      }
      const result = await Yunxiao.context(client, id)
      const context = result.context

      return {
        item: Yunxiao.toItem(context.workItem),
        description: (context.description ?? "").trim(),
        comments: (context.comments ?? []).map((comment) => ({
          author: comment.creatorName ?? "未知",
          created: comment.gmtCreate,
          content: comment.content,
        })),
        attachments: (context.attachments ?? [])
          .map((file) => ({ name: file.fileName ?? file.name ?? "", url: file.url }))
          .filter((file) => file.name),
        relations: (context.relations ?? [])
          .filter((relation) => relation.relatedWorkItem?.serialNumber)
          .map((relation) => ({
            serial: relation.relatedWorkItem?.serialNumber ?? "",
            title: relation.relatedWorkItem?.subject ?? "",
            statusName: relation.relatedWorkItem?.statusName,
            relation: relation.relationType ?? "",
          })),
      }
    },

    async setToken(token) {
      Settings.writeStored(token.trim())
      cache = undefined
      return api.state({ force: true })
    },

    async setSettings(input) {
      Settings.writeSettings(state, {
        frontendServerUrl: input.frontendServerUrl.trim() || Settings.DEFAULT_SERVER_URL,
        organizationId: input.organizationId?.trim() || undefined,
      })
      cache = undefined
      return api.state({ force: true })
    },
  }

  return api
}

export const layer = Layer.effect(
  Service,
  Effect.map(DesktopStorage.Service, (storage) => Service.of(make(storage))),
)
