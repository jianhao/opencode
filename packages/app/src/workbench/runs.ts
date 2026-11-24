import { useNavigate } from "@solidjs/router"
import { createSignal, onMount } from "solid-js"
import type { HomeController } from "@/home/model"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import type {
  WorkbenchBridge,
  WorkbenchDetail,
  WorkbenchItem,
  WorkbenchPreflight,
  WorkbenchTask,
  WorkbenchTaskDocs,
  WorkbenchTaskRun,
} from "./types"

/**
 * 工作台任务：任务身份和阶段在主进程 SQLite，规划文档在 `.opencode/workbench/<serial>/`。
 * 会话只是执行载体：一个任务可以开多次会话，每次都从规划文档接着做。
 */

export type WorkbenchRunTarget = { directory: string; name: string }

const TARGET_KEY = "workbench-target-v1"

function readTarget() {
  try {
    return globalThis.localStorage?.getItem(TARGET_KEY) ?? ""
  } catch {
    return ""
  }
}

function persistTarget(directory: string) {
  try {
    globalThis.localStorage?.setItem(TARGET_KEY, directory)
  } catch {
    // 存不下只影响下次默认值。
  }
}

const directoryName = (directory: string) => directory.split("/").filter(Boolean).at(-1) ?? directory

function plainText(value?: string) {
  if (!value) return ""

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000)
}

function brief(item: WorkbenchItem, detail: WorkbenchDetail | undefined, directory: string) {
  const lines = [
    `- 云效号：${item.serial}`,
    `- 标题：${item.title}`,
    `- 类型 / 状态：${item.categoryName} / ${item.statusName}`,
    `- 所属空间：${item.spaceName}`,
    `- 本地目录：${directory}`,
  ]

  if (item.priorityName) lines.push(`- 优先级：${item.priorityName}`)

  if (item.url) lines.push(`- 云效链接：${item.url}`)

  const description = plainText(detail?.description)

  if (description) lines.push("", "## 需求正文", description)

  return lines.join("\n")
}

function planPrompt(input: {
  item: WorkbenchItem
  detail?: WorkbenchDetail
  task: WorkbenchTask
  directory: string
}) {
  return `你在本地项目「${input.task.spaceName}」中做需求规划。当前阶段只做分析和写规划文档，不改任何业务代码。

${brief(input.item, input.detail, input.directory)}

## 规划文档目录（只允许写这里）
${input.task.planDir}

目录里已经有 brief.md 骨架。请补齐并产出：
- plan.md：目标、影响面、实现方案、风险与回滚
- tasks.md：可勾选的任务清单（Markdown checkbox），按执行顺序
- test-plan.md：自动化测试与真实 UI 验证的用例、命令、预期
- acceptance.md：验收标准与证据要求

## 约束
1. 只读其余代码；不要修改、不要 git add/commit/push。
2. 先读仓库 AGENTS.md 和相关代码，信息不足先问我，不要猜。
3. 计划要能直接指导执行，每步写清楚改哪些文件、怎么验证。
4. 写完文档后用一小段话总结，并明确说「请确认计划」。`
}

function executePrompt(input: { task: WorkbenchTask }) {
  return `计划已确认（v${input.task.planVersion}）。现在按计划执行。

规划文档目录：${input.task.planDir}
请严格按 plan.md 和 tasks.md 实施：
1. 只改当前工作区，不要 git add / commit / push。
2. 每完成一项立即把 tasks.md 里对应项改成 [x]；没做的项写明原因，不要留在未勾选状态。
3. 计划有偏差先停下来，更新 plan.md 并说明原因。
4. 结束前跑项目已有的 lint / typecheck / 相关测试，把命令和结果追加到 log.md 的「执行结果」小节（工作台会自动记阶段流水，别删）。
5. 最后输出：改了哪些文件、验证结果、剩余风险。`
}

export function createWorkbenchRuns(home: HomeController, bridge: () => WorkbenchBridge | undefined) {
  const navigate = useNavigate()
  const platform = usePlatform()
  const [tasks, setTasks] = createSignal<readonly WorkbenchTask[]>([])
  const [runs, setRuns] = createSignal<readonly WorkbenchTaskRun[]>([])
  const [starting, setStarting] = createSignal<string>()
  const [manualTarget, setManualTarget] = createSignal(readTarget())

  const api = () => bridge()

  const refresh = async () => {
    const workbench = api()

    if (!workbench) return

    try {
      const result = await workbench.tasks()
      setTasks(result.tasks)
      setRuns(result.runs)
    } catch (cause) {
      showToast({ title: "读取任务失败", description: errorMessage(cause, "工作台任务读取失败") })
    }
  }

  onMount(() => void refresh())

  const targets = (): WorkbenchRunTarget[] => {
    const seen = new Set<string>()

    const list = home.project.list().map((project) => {
      seen.add(project.worktree)

      return { directory: project.worktree, name: project.name ?? directoryName(project.worktree) }
    })

    const manual = manualTarget()

    if (manual && !seen.has(manual)) list.push({ directory: manual, name: directoryName(manual) })

    return list
  }

  const target = (directory?: string): WorkbenchRunTarget | undefined => {
    const all = targets()

    if (directory) return all.find((project) => project.directory === directory)

    const manual = manualTarget()

    if (manual) return all.find((project) => project.directory === manual) ?? all[0]

    const preferred = home.project.newSession()

    return all.find((project) => project.directory === preferred?.worktree) ?? all[0]
  }

  const pickTarget = async () => {
    if (platform.platform !== "desktop" || !platform.openDirectoryPickerDialog) {
      showToast({ title: "桌面端才能选择本地目录" })

      return
    }

    try {
      const picked = await platform.openDirectoryPickerDialog({
        title: "选择 AI 处理的项目目录",
        multiple: false,
        defaultPath: manualTarget() || home.project.newSession()?.worktree,
      })

      const directory = Array.isArray(picked) ? picked[0] : picked

      if (!directory) return

      setManualTarget(directory)
      persistTarget(directory)

      return directory
    } catch (cause) {
      showToast({ title: "选择目录失败", description: errorMessage(cause, "无法读取所选目录") })
    }
  }

  const taskFor = (itemID: string) =>
    tasks()
      .filter((task) => task.itemId === itemID)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]

  const runFor = (task: WorkbenchTask | undefined) => {
    if (!task) return

    return runs().find((run) => run.id === task.activeRunId)
  }

  const status = (sessionID: string): "running" | "idle" | "unknown" => {
    const ctx = home.server.focusedContext()

    if (!ctx) return "unknown"

    return ctx.data.session.status(sessionID) === "running" ? "running" : "idle"
  }

  const open = (run: WorkbenchTaskRun | undefined) => {
    const conn = home.server.focused()

    if (!run || !conn) return
    navigate(sessionHref(ServerConnection.key(conn), run.sessionId))
  }

  const preflight = async (directory: string) => {
    const workbench = api()

    if (!workbench) throw new Error("工作台不可用")

    return workbench.preflight(directory)
  }

  // 规划会话：只允许写规划目录，其余编辑一律拒绝。首次开始和重新规划共用这一条路径。
  const openPlanSession = async (input: { item: WorkbenchItem; detail?: WorkbenchDetail; task: WorkbenchTask }) => {
    const workbench = api()
    const ctx = home.server.focusedContext()

    if (!workbench || !ctx) throw new Error("当前没有可用的本地服务连接")

    // 权限规则匹配的是「相对会话目录」的路径（项目内文件），用绝对路径永远不会命中允许项。
    const scratch = input.task.planDir.startsWith(`${input.task.directory}/`)
      ? input.task.planDir.slice(input.task.directory.length + 1)
      : input.task.planDir

    const created = await ctx.sdk.api.session.create({
      title: `${input.item.serial} ${input.item.title}`.slice(0, 90),
      location: { directory: input.task.directory },
      metadata: { workbench: { taskId: input.task.id, serial: input.item.serial } },
      permissions: [
        { action: "edit", resource: "*", effect: "deny" },
        { action: "edit", resource: `${scratch}/*`, effect: "allow" },
      ],
    })

    await ctx.sdk.api.session.prompt({
      sessionID: created.id,
      text: planPrompt({
        item: input.item,
        detail: input.detail,
        task: input.task,
        directory: input.task.directory,
      }),
    })
    await workbench.taskBindRun({ taskId: input.task.id, sessionId: created.id, kind: "plan", stage: "planning" })

    return created.id
  }

  const start = async (input: { item: WorkbenchItem; detail?: WorkbenchDetail; directory?: string }) => {
    const workbench = api()
    const conn = home.server.focused()
    const current = target(input.directory)

    if (!workbench) throw new Error("工作台不可用")

    if (!conn) throw new Error("当前没有可用的本地服务连接")

    if (!current) throw new Error("先选择项目目录")

    setStarting(input.item.id)

    try {
      const task = await workbench.taskStart({
        itemId: input.item.id,
        serial: input.item.serial,
        title: input.item.title,
        spaceId: input.item.spaceId,
        spaceName: input.item.spaceName,
        url: input.item.url,
        directory: current.directory,
      })

      const sessionID = await openPlanSession({ item: input.item, detail: input.detail, task })

      await refresh()
      navigate(sessionHref(ServerConnection.key(conn), sessionID))

      return task
    } catch (cause) {
      showToast({ title: "没能开始规划", description: errorMessage(cause, "创建规划会话失败") })
      throw cause
    } finally {
      setStarting(undefined)
    }
  }

  // 计划被否掉或规划中断时另开一个规划会话；权限仍然只放开规划目录。
  const replan = async (input: { item: WorkbenchItem; detail?: WorkbenchDetail; task: WorkbenchTask }) => {
    const workbench = api()
    const conn = home.server.focused()

    if (!workbench) throw new Error("工作台不可用")

    if (!conn) throw new Error("当前没有可用的本地服务连接")

    try {
      const task = await workbench.taskSetStage({ id: input.task.id, stage: "planning" })
      const sessionID = await openPlanSession({ item: input.item, detail: input.detail, task })

      await refresh()
      navigate(sessionHref(ServerConnection.key(conn), sessionID))

      return task
    } catch (cause) {
      showToast({ title: "没能重新规划", description: errorMessage(cause, "创建规划会话失败") })
      throw cause
    }
  }

  const approve = async (task: WorkbenchTask) => {
    const workbench = api()
    const conn = home.server.focused()
    const ctx = conn ? home.server.focusedContext() : undefined
    const active = runFor(task)

    if (!workbench || !conn || !ctx) throw new Error("当前没有可用的本地服务连接")

    if (!active) throw new Error("找不到规划会话")

    try {
      // 先放开写权限并发出执行提示，再把任务推进到 executing；反过来会让失败的任务卡在“已批准但没执行”。
      await ctx.sdk.api.session.update({
        sessionID: active.sessionId,
        permissions: [{ action: "edit", resource: "*", effect: "allow" }],
      })
      await ctx.sdk.api.session.prompt({
        sessionID: active.sessionId,
        text: executePrompt({ task: { ...task, planVersion: task.planVersion + 1 } }),
      })

      const next = await workbench.taskApprove(task.id)

      // 同一个会话从规划切到执行，运行记录要单开一条，处理记录里才分得清规划和执行。
      await workbench.taskBindRun({
        taskId: task.id,
        sessionId: active.sessionId,
        kind: "execute",
        stage: "executing",
      })
      await refresh()
      navigate(sessionHref(ServerConnection.key(conn), active.sessionId))

      return next
    } catch (cause) {
      showToast({ title: "没能开始执行", description: errorMessage(cause, "批准计划失败") })
      throw cause
    }
  }

  // 阶段推进由人点：AI 停下来提问不等于活干完了，不能按会话空闲自动前进。
  const advance = async (task: WorkbenchTask, stage: "verifying" | "done") => {
    const workbench = api()

    if (!workbench) throw new Error("工作台不可用")

    try {
      const next = await workbench.taskSetStage({ id: task.id, stage })

      await refresh()

      return next
    } catch (cause) {
      showToast({ title: "没能更新任务阶段", description: errorMessage(cause, "更新任务阶段失败") })
      throw cause
    }
  }

  const docs = async (task: WorkbenchTask): Promise<WorkbenchTaskDocs | undefined> => {
    const workbench = api()

    if (!workbench) return

    return workbench.taskDocs(task.id)
  }

  return {
    tasks,
    runs,
    starting,
    targets,
    target,
    pickTarget,
    taskFor,
    runFor,
    status,
    open,
    preflight,
    start,
    replan,
    approve,
    advance,
    docs,
    refresh,
    busy: (itemID: string) => starting() === itemID,
  }
}

export type WorkbenchRuns = ReturnType<typeof createWorkbenchRuns>

export type { WorkbenchPreflight }
