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
  items: Schema.Array(Item),
  counts: Counts,
  warnings: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
})

const Comment = Schema.Struct({
  author: Schema.String,
  created: Schema.optional(Schema.String),
  content: Schema.String,
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

export const WorkbenchDetail = Schema.Struct({
  item: Item,
  description: Schema.String,
  comments: Schema.Array(Comment),
  attachments: Schema.Array(Attachment),
  relations: Schema.Array(Relation),
})

export const WorkbenchGetState = Rpc.make("WorkbenchGetState", {
  payload: { force: Schema.optional(Schema.Boolean) },
  success: WorkbenchSnapshot,
})

export const WorkbenchGetItem = Rpc.make("WorkbenchGetItem", {
  payload: { id: Schema.String },
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

export const WorkbenchRpcs = RpcGroup.make(WorkbenchGetState, WorkbenchGetItem, WorkbenchSetToken, WorkbenchSetSettings)

export type Snapshot = Schema.Schema.Type<typeof WorkbenchSnapshot>

export type Detail = Schema.Schema.Type<typeof WorkbenchDetail>
