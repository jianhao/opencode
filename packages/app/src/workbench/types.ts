/**
 * Workbench view types.
 *
 * The main process contract lives in `@opencode/desktop`'s shared ipc-rpc; this package keeps a
 * structural copy so the app never imports the desktop package. `createDesktopPlatform` returns an
 * object that must stay assignable to `WorkbenchBridge` below.
 */

export type Readiness = "ready" | "clarify" | "blocked"

export type WorkbenchReason = { level: "pass" | "risk" | "block"; message: string }

export type WorkbenchItem = {
  id: string
  source: "yunxiao" | "manual"
  serial: string
  title: string
  url?: string
  category: "Req" | "Task" | "Bug" | "Other"
  categoryName: string
  statusName: string
  statusStage?: string
  priority?: string
  priorityName?: string
  spaceId: string
  spaceName: string
  creatorName?: string
  assigneeName?: string
  createdAt?: string
  updatedAt?: string
  readiness: Readiness
  reasons: readonly WorkbenchReason[]
}

export type WorkbenchSnapshot = {
  serverUrl: string
  fetchedAt: number
  token: { configured: boolean; source: "env" | "stored" | "none"; userName?: string }
  // 云效工作流状态清单；Tab 顺序与“全部”的任务范围都由它决定。
  statuses: readonly string[]
  items: readonly WorkbenchItem[]
  counts: { total: number; ready: number; clarify: number; blocked: number }
  warnings: readonly string[]
  error?: string
}

// 云效详情配置：与 yunxiao-web 的分析配置对齐，导出 HTML 那一项工作台不用。
export type WorkbenchDetailConfig = {
  includeCurrentContent: boolean
  includeCurrentComments: boolean
  includeParentContent: boolean
  includeParentComments: boolean
  includeLinkedContent: boolean
  includeLinkedComments: boolean
  includeChildContent: boolean
  includeChildComments: boolean
  includeAttachments: boolean
  includeRelations: boolean
  includeActivities: boolean
  includeExternalLinks: boolean
}

export const DEFAULT_DETAIL_CONFIG: WorkbenchDetailConfig = {
  includeCurrentContent: true,
  includeCurrentComments: true,
  includeParentContent: true,
  includeParentComments: true,
  includeLinkedContent: true,
  includeLinkedComments: true,
  includeChildContent: true,
  includeChildComments: true,
  includeAttachments: true,
  includeRelations: true,
  includeActivities: true,
  includeExternalLinks: true,
}

export type WorkbenchComment = { author: string; created?: string; content: string; contentHtml: string }

// 父项/子项/关联项只带展示需要的正文和评论。
export type WorkbenchSubItem = {
  item: WorkbenchItem
  description: string
  descriptionHtml: string
  comments: ReadonlyArray<WorkbenchComment>
}

export type WorkbenchDetail = WorkbenchSubItem & {
  attachments: ReadonlyArray<{ name: string; url?: string }>
  relations: ReadonlyArray<{ serial: string; title: string; statusName?: string; relation: string }>
  parent?: WorkbenchSubItem
  children: ReadonlyArray<WorkbenchSubItem>
  linked: ReadonlyArray<WorkbenchSubItem>
  activities: ReadonlyArray<{ author: string; action: string; created?: string }>
}

export type TaskStage =
  | "planning"
  | "plan_review"
  | "executing"
  | "verifying"
  | "reviewing"
  | "accepting"
  | "releasing"
  | "done"
  | "failed"
  | "cancelled"

export type WorkbenchTask = {
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

export type WorkbenchTaskRun = {
  id: string
  taskId: string
  sessionId: string
  kind: string
  stage: string
  summary?: string
  createdAt: number
  endedAt?: number
}

export type WorkbenchPreflight = {
  repo: boolean
  branch?: string
  dirty: boolean
  modified: number
  untracked: number
  files: readonly string[]
  error?: string
}

export type WorkbenchTaskDocs = {
  brief: string
  plan: string
  tasks: string
  testPlan: string
  acceptance: string
  review: string
  log: string
}

export type WorkbenchBridge = {
  state(force?: boolean): Promise<WorkbenchSnapshot>
  item(id: string, config?: WorkbenchDetailConfig): Promise<WorkbenchDetail>
  setToken(token: string): Promise<WorkbenchSnapshot>
  setSettings(input: { frontendServerUrl: string; organizationId?: string }): Promise<WorkbenchSnapshot>
  preflight(directory: string): Promise<WorkbenchPreflight>
  tasks(): Promise<{ tasks: readonly WorkbenchTask[]; runs: readonly WorkbenchTaskRun[] }>
  taskStart(input: {
    itemId: string
    serial: string
    title: string
    spaceId: string
    spaceName: string
    url?: string
    directory: string
  }): Promise<WorkbenchTask>
  taskSetStage(input: { id: string; stage: TaskStage; summary?: string }): Promise<WorkbenchTask>
  taskBindRun(input: {
    taskId: string
    sessionId: string
    kind: string
    stage?: TaskStage
  }): Promise<WorkbenchTaskRun>
  taskApprove(id: string): Promise<WorkbenchTask>
  taskDocs(id: string): Promise<WorkbenchTaskDocs>
}
