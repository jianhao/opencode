import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { and, desc, eq } from "drizzle-orm"
import type { Database } from "../storage/database"
import { workbenchEvent, workbenchRun, workbenchTask } from "../storage/schema"

/**
 * Workbench tasks: identity and stage in SQLite, human-readable plan/evidence under
 * `<directory>/.opencode/workbench/<serial>/`. Nothing here touches Yunxiao or git history:
 * preflight and checkpoints are read-only, and the session does the actual edits.
 */

const run = promisify(execFile)

export const TASK_STAGES = [
  "planning",
  "plan_review",
  "executing",
  "verifying",
  "reviewing",
  "accepting",
  "releasing",
  "done",
  "failed",
  "cancelled",
] as const

export type TaskStage = (typeof TASK_STAGES)[number]

export type TaskInput = {
  itemId: string
  serial: string
  title: string
  spaceId: string
  spaceName: string
  url?: string
}

export type Task = {
  id: string
  itemId: string
  serial: string
  title: string
  spaceId: string
  spaceName: string
  url?: string
  directory: string
  branch?: string
  stage: TaskStage
  planDir: string
  planVersion: number
  activeRunId?: string
  createdAt: number
  updatedAt: number
}

export type TaskRun = {
  id: string
  taskId: string
  sessionId: string
  kind: string
  stage: string
  summary?: string
  createdAt: number
  endedAt?: number
}

export type Preflight = {
  repo: boolean
  branch?: string
  dirty: boolean
  modified: number
  untracked: number
  files: string[]
  error?: string
}

export type TaskDocs = {
  brief: string
  plan: string
  tasks: string
  testPlan: string
  acceptance: string
  review: string
  log: string
}

const DOC_KEYS = ["brief", "plan", "tasks", "testPlan", "acceptance", "review", "log"] as const

const FILE_NAMES = {
  brief: "brief.md",
  plan: "plan.md",
  tasks: "tasks.md",
  testPlan: "test-plan.md",
  acceptance: "acceptance.md",
  review: "review.md",
  log: "log.md",
} as const

const git = async (directory: string, args: string[]) => {
  const result = await run("git", ["-C", directory, ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })

  return result.stdout
}

export async function preflight(directory: string): Promise<Preflight> {
  const resolved = path.resolve(directory)

  if (!existsSync(resolved)) return { repo: false, dirty: false, modified: 0, untracked: 0, files: [], error: "目录不存在" }

  const info = await stat(resolved).catch(() => undefined)

  if (!info?.isDirectory())
    return { repo: false, dirty: false, modified: 0, untracked: 0, files: [], error: "不是目录" }

  try {
    const branch = (await git(resolved, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
    const status = await git(resolved, ["status", "--porcelain=v1", "-z"])

    const entries = status
      .split("\0")
      .filter(Boolean)
      .map((entry) => ({ code: entry.slice(0, 2), file: entry.slice(3) }))

    const untracked = entries.filter((entry) => entry.code === "??")
    const modified = entries.filter((entry) => entry.code !== "??")

    return {
      repo: true,
      branch,
      dirty: entries.length > 0,
      modified: modified.length,
      untracked: untracked.length,
      files: entries.slice(0, 8).map((entry) => entry.file),
    }
  } catch (cause) {
    return {
      repo: false,
      dirty: false,
      modified: 0,
      untracked: 0,
      files: [],
      error: cause instanceof Error ? cause.message : "git 命令失败",
    }
  }
}

const safeSerial = (serial: string) => serial.replace(/[^a-zA-Z0-9._-]/g, "_") || "task"

function template(input: TaskInput, directory: string, branch: string | undefined) {
  const facts = [
    `- 云效号：${input.serial}`,
    `- 标题：${input.title}`,
    `- 所属空间：${input.spaceName}`,
    `- 本地目录：${directory}`,
    `- 当前分支：${branch ?? "未知"}`,
  ]

  if (input.url) facts.push(`- 云效链接：${input.url}`)

  return {
    brief: `# ${input.serial} ${input.title}\n\n${facts.join("\n")}\n\n## 需求正文\n\n（从云效详情补充：背景、复现步骤、约束、验收口径）\n`,
    plan: `# 方案 · ${input.serial}\n\n## 目标\n\n## 影响面\n\n## 实现方案\n\n## 风险与回滚\n`,
    tasks: `# 任务清单 · ${input.serial}\n\n- [ ] 阅读相关代码与 AGENTS.md\n- [ ] 确认复现路径\n- [ ] 按方案实现\n- [ ] 跑 lint / typecheck / 测试\n- [ ] 整理验证证据\n`,
    testPlan: `# 测试计划 · ${input.serial}\n\n## 自动化\n\n## 手工 / 真实 UI\n\n## 预期结果\n`,
    acceptance: `# 验收标准 · ${input.serial}\n\n- [ ] 需求中的每条验收标准都有证据\n- [ ] lint / typecheck / 测试通过\n- [ ] 真实 UI 流程通过\n- [ ] 回滚方式明确\n`,
    review: "",
    log: `# 处理记录 · ${input.serial}\n\n`,
  }
}

function stageOf(value: string): TaskStage {
  return TASK_STAGES.find((stage) => stage === value) ?? "planning"
}

function toTask(row: typeof workbenchTask.$inferSelect): Task {
  return {
    id: row.id,
    itemId: row.item_id,
    serial: row.serial,
    title: row.title,
    spaceId: row.space_id,
    spaceName: row.space_name,
    url: row.url ?? undefined,
    directory: row.directory,
    branch: row.branch ?? undefined,
    stage: stageOf(row.stage),
    planDir: row.plan_dir,
    planVersion: row.plan_version,
    activeRunId: row.active_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRun(row: typeof workbenchRun.$inferSelect): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    kind: row.kind,
    stage: row.stage,
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? undefined,
  }
}

type EventPayload = { [key: string]: string | number | boolean | null | undefined }

const STAGE_HEADING = "## 阶段记录"

// 阶段履历直接写进 log.md：模型漏写日志时，任务也还有一份可核对的流水。
async function recordStage(task: Task, stage: TaskStage) {
  const file = path.join(task.planDir, FILE_NAMES.log)
  const current = await readFile(file, "utf8").catch(() => `# 处理记录 · ${task.serial}\n`)
  const status = await git(task.directory, ["status", "--porcelain=v1"]).catch(() => undefined)

  const entries = (status ?? "").split("\n").filter(Boolean)
  const untracked = entries.filter((entry) => entry.startsWith("??")).length
  const changed = entries.length - untracked
  const workspace = status === undefined ? "工作区读取失败" : `工作区 ${changed} 改动 / ${untracked} 未跟踪`
  const now = new Date()
  const time = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  const heading = current.includes(STAGE_HEADING) ? "" : `\n\n${STAGE_HEADING}\n`
  const line = `${time} · ${task.stage} → ${stage} · ${workspace}`

  await writeFile(file, `${current.trimEnd()}${heading}\n- ${line}\n`)
}

const event = (db: Database, taskId: string, type: string, payload?: EventPayload) =>
  db.insert(workbenchEvent).values({
    id: `ev_${randomUUID()}`,
    task_id: taskId,
    type,
    payload: payload === undefined ? null : JSON.stringify(payload),
    created_at: Date.now(),
  })

export function createTaskStore(db: Database) {
  const find = (itemId: string, directory: string) =>
    db
      .select()
      .from(workbenchTask)
      .where(and(eq(workbenchTask.item_id, itemId), eq(workbenchTask.directory, directory)))
      .get()

  const get = (id: string) => db.select().from(workbenchTask).where(eq(workbenchTask.id, id)).get()

  const api = {
    preflight,

    list() {
      const tasks = db.select().from(workbenchTask).orderBy(desc(workbenchTask.updated_at)).all().map(toTask)
      const runs = db.select().from(workbenchRun).orderBy(desc(workbenchRun.created_at)).all().map(toRun)

      return { tasks, runs }
    },

    async start(input: TaskInput & { directory: string }) {
      const directory = path.resolve(input.directory)
      const check = await preflight(directory)

      if (!check.repo) throw new Error(check.error ? `无法使用该目录：${check.error}` : "该目录不是 git 仓库")

      const existing = find(input.itemId, directory)

      if (existing) return toTask(existing)

      const id = `wb_${randomUUID()}`
      const planDir = path.join(directory, ".opencode", "workbench", safeSerial(input.serial))
      const now = Date.now()
      const content = template(input, directory, check.branch)

      await mkdir(planDir, { recursive: true })
      await writeFile(path.join(planDir, ".gitignore"), "*\n")
      await Promise.all(
        DOC_KEYS.map((key) => writeFile(path.join(planDir, FILE_NAMES[key]), content[key])),
      )

      // Checkpoint: enough to recover by hand if a session goes sideways. Never auto-reverted.
      const [head, diff, status] = await Promise.all([
        git(directory, ["rev-parse", "HEAD"]).catch(() => ""),
        git(directory, ["diff", "HEAD"]).catch(() => ""),
        git(directory, ["status", "--porcelain=v1"]).catch(() => ""),
      ])

      await writeFile(
        path.join(planDir, "checkpoint.json"),
        JSON.stringify(
          { head: head.trim(), branch: check.branch, createdAt: new Date(now).toISOString(), dirty: check.dirty },
          null,
          2,
        ),
      )
      await Promise.all([
        writeFile(path.join(planDir, "checkpoint.patch"), diff),
        writeFile(path.join(planDir, "checkpoint.status.txt"), status),
      ])

      db.insert(workbenchTask)
        .values({
          id,
          item_id: input.itemId,
          serial: input.serial,
          title: input.title,
          space_id: input.spaceId,
          space_name: input.spaceName,
          url: input.url ?? null,
          directory,
          branch: check.branch ?? null,
          stage: "planning",
          plan_dir: planDir,
          plan_version: 0,
          active_run_id: null,
          created_at: now,
          updated_at: now,
        })
        .run()
      event(db, id, "task.created", { serial: input.serial, directory, branch: check.branch }).run()

      return toTask(db.select().from(workbenchTask).where(eq(workbenchTask.id, id)).get()!)
    },

    async setStage(id: string, stage: TaskStage, summary?: string) {
      const task = get(id)

      if (!task) throw new Error("任务不存在")

      db.update(workbenchTask)
        .set({ stage, updated_at: Date.now() })
        .where(eq(workbenchTask.id, id))
        .run()

      if (summary) {
        const active = task.active_run_id
          ? db.select().from(workbenchRun).where(eq(workbenchRun.id, task.active_run_id)).get()
          : undefined

        if (active) db.update(workbenchRun).set({ summary }).where(eq(workbenchRun.id, active.id)).run()
      }

      event(db, id, `stage.${stage}`, { summary }).run()
      await recordStage(toTask(task), stage)

      return toTask(get(id)!)
    },

    async bindRun(input: { taskId: string; sessionId: string; kind: string; stage?: TaskStage }) {
      const task = get(input.taskId)

      if (!task) throw new Error("任务不存在")

      const id = `run_${randomUUID()}`

      db.insert(workbenchRun)
        .values({
          id,
          task_id: input.taskId,
          session_id: input.sessionId,
          kind: input.kind,
          stage: input.stage ?? task.stage,
          created_at: Date.now(),
        })
        .run()
      db.update(workbenchTask)
        .set({ active_run_id: id, updated_at: Date.now() })
        .where(eq(workbenchTask.id, input.taskId))
        .run()
      event(db, input.taskId, "run.started", { runId: id, sessionId: input.sessionId, kind: input.kind }).run()

      return toRun(db.select().from(workbenchRun).where(eq(workbenchRun.id, id)).get()!)
    },

    async approve(id: string) {
      const task = get(id)

      if (!task) throw new Error("任务不存在")

      if (task.stage !== "planning" && task.stage !== "plan_review") throw new Error("当前阶段不能批准计划")

      db.update(workbenchTask)
        .set({ stage: "executing", plan_version: task.plan_version + 1, updated_at: Date.now() })
        .where(eq(workbenchTask.id, id))
        .run()
      event(db, id, "plan.approved", { version: task.plan_version + 1 }).run()
      await recordStage(toTask(task), "executing")

      return toTask(get(id)!)
    },

    async docs(id: string): Promise<TaskDocs> {
      const task = get(id)

      if (!task) throw new Error("任务不存在")

      const read = async (file: string) =>
        readFile(path.join(task.plan_dir, file), "utf8").catch(() => "")

      return {
        brief: await read(FILE_NAMES.brief),
        plan: await read(FILE_NAMES.plan),
        tasks: await read(FILE_NAMES.tasks),
        testPlan: await read(FILE_NAMES.testPlan),
        acceptance: await read(FILE_NAMES.acceptance),
        review: await read(FILE_NAMES.review),
        log: await read(FILE_NAMES.log),
      }
    },

    remove(id: string) {
      db.delete(workbenchTask).where(eq(workbenchTask.id, id)).run()
      event(db, id, "task.removed").run()
    },
  }

  return api
}

export type TaskStore = ReturnType<typeof createTaskStore>
