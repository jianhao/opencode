import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

/**
 * Workbench reads the current user's Yunxiao work items through the local frontend-server.
 * V1 is read-only: nothing here changes Yunxiao, git, or the filesystem.
 */

const Readiness = Schema.Literals(["ready", "clarify", "blocked"])

const Source = Schema.Literals(["yunxiao", "manual"])

const Category = Schema.Literals(["Req", "Task", "Bug", "Other"])

const TokenSource = Schema.Literals(["env", "stored", "none"])

const Reason = Schema.Struct({
  level: Schema.Literals(["pass", "risk", "block"]),
  message: Schema.String,
})

const Item = Schema.Struct({
  id: Schema.String,
  source: Source,
  serial: Schema.String,
  title: Schema.String,
  url: Schema.optional(Schema.String),
  category: Category,
  categoryName: Schema.String,
  statusName: Schema.String,
  statusStage: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.String),
  priorityName: Schema.optional(Schema.String),
  spaceId: Schema.String,
  spaceName: Schema.String,
  creatorName: Schema.optional(Schema.String),
  assigneeName: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  readiness: Readiness,
  reasons: Schema.Array(Reason),
})

const Counts = Schema.Struct({
  total: Schema.Number,
  ready: Schema.Number,
  clarify: Schema.Number,
  blocked: Schema.Number,
})

const TokenStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: TokenSource,
  userName: Schema.optional(Schema.String),
})

export const WorkbenchSnapshot = Schema.Struct({
  serverUrl: Schema.String,
  fetchedAt: Schema.Number,
  token: TokenStatus,
  statuses: Schema.Array(Schema.String),
  items: Schema.Array(Item),
  counts: Counts,
  warnings: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
})

const Comment = Schema.Struct({
  author: Schema.String,
  created: Schema.optional(Schema.String),
  content: Schema.String,
  contentHtml: Schema.String,
})

const Attachment = Schema.Struct({
  name: Schema.String,
  url: Schema.optional(Schema.String),
})

const Relation = Schema.Struct({
  serial: Schema.String,
  title: Schema.String,
  statusName: Schema.optional(Schema.String),
  relation: Schema.String,
})

// 云效详情配置：和 yunxiao-web 的分析配置一一对应（导出 HTML 那一项工作台用不到，不抄）。
export const WorkbenchDetailConfig = Schema.Struct({
  includeCurrentContent: Schema.Boolean,
  includeCurrentComments: Schema.Boolean,
  includeParentContent: Schema.Boolean,
  includeParentComments: Schema.Boolean,
  includeLinkedContent: Schema.Boolean,
  includeLinkedComments: Schema.Boolean,
  includeChildContent: Schema.Boolean,
  includeChildComments: Schema.Boolean,
  includeAttachments: Schema.Boolean,
  includeRelations: Schema.Boolean,
  includeActivities: Schema.Boolean,
  includeExternalLinks: Schema.Boolean,
})

export const WorkbenchActivity = Schema.Struct({
  author: Schema.String,
  action: Schema.String,
  created: Schema.optional(Schema.String),
})

// 父项/关联项/子项只带展示需要的正文和评论，避免无限递归。
export const WorkbenchContext = Schema.Struct({
  item: Item,
  description: Schema.String,
  descriptionHtml: Schema.String,
  comments: Schema.Array(Comment),
})

export const WorkbenchDetail = Schema.Struct({
  item: Item,
  description: Schema.String,
  descriptionHtml: Schema.String,
  comments: Schema.Array(Comment),
  attachments: Schema.Array(Attachment),
  relations: Schema.Array(Relation),
  parent: Schema.optional(WorkbenchContext),
  children: Schema.Array(WorkbenchContext),
  linked: Schema.Array(WorkbenchContext),
  activities: Schema.Array(WorkbenchActivity),
})

export const WorkbenchTaskStage = Schema.Literals([
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
])

export const WorkbenchTask = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  serial: Schema.String,
  title: Schema.String,
  spaceId: Schema.String,
  spaceName: Schema.String,
  url: Schema.optional(Schema.String),
  directory: Schema.String,
  branch: Schema.optional(Schema.String),
  stage: WorkbenchTaskStage,
  planDir: Schema.String,
  planVersion: Schema.Number,
  activeRunId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const WorkbenchTaskRun = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  sessionId: Schema.String,
  kind: Schema.String,
  stage: Schema.String,
  summary: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
})

export const WorkbenchPreflight = Schema.Struct({
  repo: Schema.Boolean,
  branch: Schema.optional(Schema.String),
  dirty: Schema.Boolean,
  modified: Schema.Number,
  untracked: Schema.Number,
  files: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
})

export const WorkbenchTaskDocs = Schema.Struct({
  brief: Schema.String,
  plan: Schema.String,
  tasks: Schema.String,
  testPlan: Schema.String,
  acceptance: Schema.String,
  review: Schema.String,
  log: Schema.String,
})

export const WorkbenchGetState = Rpc.make("WorkbenchGetState", {
  payload: { force: Schema.optional(Schema.Boolean) },
  success: WorkbenchSnapshot,
})

export const WorkbenchGetItem = Rpc.make("WorkbenchGetItem", {
  payload: { id: Schema.String, config: Schema.optional(WorkbenchDetailConfig) },
  success: WorkbenchDetail,
})

export const WorkbenchSetToken = Rpc.make("WorkbenchSetToken", {
  payload: { token: Schema.String },
  success: WorkbenchSnapshot,
})

export const WorkbenchSetSettings = Rpc.make("WorkbenchSetSettings", {
  payload: { frontendServerUrl: Schema.String, organizationId: Schema.optional(Schema.String) },
  success: WorkbenchSnapshot,
})

export const WorkbenchPreflightRpc = Rpc.make("WorkbenchPreflight", {
  payload: { directory: Schema.String },
  success: WorkbenchPreflight,
})

export const WorkbenchTaskList = Rpc.make("WorkbenchTaskList", {
  success: Schema.Struct({ tasks: Schema.Array(WorkbenchTask), runs: Schema.Array(WorkbenchTaskRun) }),
})

export const WorkbenchTaskStart = Rpc.make("WorkbenchTaskStart", {
  payload: {
    itemId: Schema.String,
    serial: Schema.String,
    title: Schema.String,
    spaceId: Schema.String,
    spaceName: Schema.String,
    url: Schema.optional(Schema.String),
    directory: Schema.String,
  },
  success: WorkbenchTask,
})

export const WorkbenchTaskSetStage = Rpc.make("WorkbenchTaskSetStage", {
  payload: { id: Schema.String, stage: WorkbenchTaskStage, summary: Schema.optional(Schema.String) },
  success: WorkbenchTask,
})

export const WorkbenchTaskBindRun = Rpc.make("WorkbenchTaskBindRun", {
  payload: {
    taskId: Schema.String,
    sessionId: Schema.String,
    kind: Schema.String,
    stage: Schema.optional(WorkbenchTaskStage),
  },
  success: WorkbenchTaskRun,
})

export const WorkbenchTaskApprove = Rpc.make("WorkbenchTaskApprove", {
  payload: { id: Schema.String },
  success: WorkbenchTask,
})

export const WorkbenchTaskDocsRpc = Rpc.make("WorkbenchTaskDocs", {
  payload: { id: Schema.String },
  success: WorkbenchTaskDocs,
})

export const WorkbenchRpcs = RpcGroup.make(
  WorkbenchGetState,
  WorkbenchGetItem,
  WorkbenchSetToken,
  WorkbenchSetSettings,
  WorkbenchPreflightRpc,
  WorkbenchTaskList,
  WorkbenchTaskStart,
  WorkbenchTaskSetStage,
  WorkbenchTaskBindRun,
  WorkbenchTaskApprove,
  WorkbenchTaskDocsRpc,
)

export type Snapshot = Schema.Schema.Type<typeof WorkbenchSnapshot>

export type Detail = Schema.Schema.Type<typeof WorkbenchDetail>

export type DetailConfig = Schema.Schema.Type<typeof WorkbenchDetailConfig>

export type TaskStage = Schema.Schema.Type<typeof WorkbenchTaskStage>

export type Task = Schema.Schema.Type<typeof WorkbenchTask>

export type TaskRun = Schema.Schema.Type<typeof WorkbenchTaskRun>

export type Preflight = Schema.Schema.Type<typeof WorkbenchPreflight>

export type TaskDocs = Schema.Schema.Type<typeof WorkbenchTaskDocs>
