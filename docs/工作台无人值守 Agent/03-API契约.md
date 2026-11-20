# 03 · API 契约

> 位置：`packages/desktop/src/shared/ipc-rpc/workbench.ts`
> 风格：Effect RPC + Effect Schema，与 `storage.ts` / `files.ts` 一致
> 原则：一次调用返回一份完整快照；写操作只写工作台自己的数据

## 1. Schema 定义

```ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const Readiness = Schema.Literals(["ready", "partial", "blocked"])
const Source = Schema.Literals(["yunxiao", "manual"])
const Category = Schema.Literals(["Req", "Task", "Bug", "Other"])
const Priority = Schema.Literals(["P0", "P1", "P2", "P3"])

const Reason = Schema.Struct({
  level: Schema.Literals(["pass", "risk", "block"]),
  code: Schema.String,
  message: Schema.String,
})

const Candidate = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(["main", "worktree"]),
  exists: Schema.Boolean,
})

const Mapping = Schema.Struct({
  projectKey: Schema.optionalKey(Schema.String),
  workspacePath: Schema.optionalKey(Schema.String),
  workspaceKind: Schema.Literals(["main", "worktree", "missing"]),
  workspaceCandidates: Schema.Array(Candidate),
  gitRemote: Schema.optionalKey(Schema.String),
  currentBranch: Schema.optionalKey(Schema.String),
  envBranch: Schema.optionalKey(Schema.String),
  branchMatch: Schema.optionalKey(Schema.Boolean),
  dirty: Schema.optionalKey(Schema.Boolean),
  unresolvedReason: Schema.optionalKey(Schema.String),
})

const Item = Schema.Struct({
  id: Schema.String,
  source: Source,
  serial: Schema.String,
  title: Schema.String,
  url: Schema.optionalKey(Schema.String),
  category: Category,
  status: Schema.String,
  priority: Schema.optionalKey(Priority),
  airlineCode: Schema.optionalKey(Schema.String),
  spaceId: Schema.optionalKey(Schema.String),
  spaceName: Schema.optionalKey(Schema.String),
  projectKey: Schema.optionalKey(Schema.String),
  branch: Schema.optionalKey(Schema.String),
  createdAt: Schema.optionalKey(Schema.String),
  updatedAt: Schema.optionalKey(Schema.String),
  commentCount: Schema.Number,
  attachmentCount: Schema.Number,
  readiness: Readiness,
  reasons: Schema.Array(Reason),
  missing: Schema.Array(Schema.String),
  mapping: Schema.optionalKey(Mapping),
})

const ProjectBinding = Schema.Struct({
  enabled: Schema.Boolean,
  main: Schema.String,
  worktrees: Schema.Array(Schema.String),
  verifyProfile: Schema.optionalKey(Schema.String),
})

const SpaceBinding = Schema.Struct({
  projectKey: Schema.String,
  airlineCode: Schema.optionalKey(Schema.String),
  confirmed: Schema.Boolean,
  source: Schema.Literals(["auto", "manual"]),
})

const Settings = Schema.Struct({
  frontendServerUrl: Schema.String,
  projectRoot: Schema.String,
  toolsRoot: Schema.String,
  pollIntervalMs: Schema.Number,
  maxItems: Schema.Number,
  includeWorktrees: Schema.Boolean,
  debugRaw: Schema.Boolean,
  projects: Schema.Record(Schema.String, ProjectBinding),
  spaceBindings: Schema.Record(Schema.String, SpaceBinding),
})

const ProjectStatus = Schema.Struct({
  projectKey: Schema.String,
  airlineCodes: Schema.Array(Schema.String),
  main: Schema.String,
  worktrees: Schema.Array(Schema.String),
  resolvedWorkspace: Schema.optionalKey(Schema.String),
  exists: Schema.Boolean,
  isGitRepo: Schema.Boolean,
  gitRemote: Schema.optionalKey(Schema.String),
  currentBranch: Schema.optionalKey(Schema.String),
  envBranches: Schema.Array(Schema.String),
  dirty: Schema.optionalKey(Schema.Boolean),
  binding: Schema.Literals(["bound", "unbound", "path-missing", "not-git", "ambiguous"]),
  warning: Schema.optionalKey(Schema.String),
})

const Snapshot = Schema.Struct({
  settings: Settings,
  token: Schema.Struct({
    configured: Schema.Boolean,
    memberName: Schema.optionalKey(Schema.String),
    userId: Schema.optionalKey(Schema.String),
    persistent: Schema.Boolean,
  }),
  sync: Schema.Struct({
    at: Schema.NullOr(Schema.String),
    durationMs: Schema.Number,
    ok: Schema.Boolean,
    partial: Schema.Boolean,
    warnings: Schema.Array(
      Schema.Struct({
        scope: Schema.Literals(["project", "global"]),
        key: Schema.optionalKey(Schema.String),
        code: Schema.String,
        message: Schema.String,
      }),
    ),
  }),
  projects: Schema.Array(ProjectStatus),
  items: Schema.Array(Item),
  counts: Schema.Struct({
    total: Schema.Number,
    ready: Schema.Number,
    partial: Schema.Number,
    blocked: Schema.Number,
    unbound: Schema.Number,
  }),
})
```

## 2. RPC 清单

```ts
export const WorkbenchGetState = Rpc.make("WorkbenchGetState", {
  payload: { force: Schema.optionalKey(Schema.Boolean) },
  success: Snapshot,
})

export const WorkbenchSaveSettings = Rpc.make("WorkbenchSaveSettings", {
  payload: { patch: Schema.partial(Settings) },
  success: Snapshot,
})

export const WorkbenchValidateToken = Rpc.make("WorkbenchValidateToken", {
  payload: { token: Schema.String },
  success: Schema.Struct({
    ok: Schema.Boolean,
    memberName: Schema.optionalKey(Schema.String),
    userId: Schema.optionalKey(Schema.String),
    error: Schema.optionalKey(Schema.String),
  }),
})

export const WorkbenchSaveToken = Rpc.make("WorkbenchSaveToken", {
  payload: { token: Schema.String },
  success: Snapshot,
})

export const WorkbenchClearToken = Rpc.make("WorkbenchClearToken", { success: Snapshot })

export const WorkbenchImportTokenFromBinding = Rpc.make("WorkbenchImportTokenFromBinding", {
  success: Schema.Struct({ ok: Schema.Boolean, error: Schema.optionalKey(Schema.String) }),
})

export const WorkbenchRescan = Rpc.make("WorkbenchRescan", { success: Snapshot })

export const WorkbenchAddManualItem = Rpc.make("WorkbenchAddManualItem", {
  payload: {
    item: Schema.Struct({
      title: Schema.String,
      serial: Schema.optionalKey(Schema.String),
      projectKey: Schema.String,
      workspace: Schema.optionalKey(Schema.String),
      branch: Schema.optionalKey(Schema.String),
      airlineCode: Schema.optionalKey(Schema.String),
      priority: Schema.optionalKey(Priority),
      url: Schema.optionalKey(Schema.String),
      note: Schema.optionalKey(Schema.String),
    }),
  },
  success: Snapshot,
})

export const WorkbenchUpdateManualItem = Rpc.make("WorkbenchUpdateManualItem", {
  payload: {
    id: Schema.String,
    patch: Schema.Struct({
      title: Schema.optionalKey(Schema.String),
      serial: Schema.optionalKey(Schema.String),
      projectKey: Schema.optionalKey(Schema.String),
      workspace: Schema.optionalKey(Schema.String),
      branch: Schema.optionalKey(Schema.String),
      airlineCode: Schema.optionalKey(Schema.String),
      priority: Schema.optionalKey(Priority),
      url: Schema.optionalKey(Schema.String),
      note: Schema.optionalKey(Schema.String),
    }),
  },
  success: Snapshot,
})

export const WorkbenchRemoveManualItem = Rpc.make("WorkbenchRemoveManualItem", {
  payload: { id: Schema.String },
  success: Snapshot,
})

export const WorkbenchRpcs = RpcGroup.make(
  WorkbenchGetState,
  WorkbenchSaveSettings,
  WorkbenchValidateToken,
  WorkbenchSaveToken,
  WorkbenchClearToken,
  WorkbenchImportTokenFromBinding,
  WorkbenchRescan,
  WorkbenchAddManualItem,
  WorkbenchUpdateManualItem,
  WorkbenchRemoveManualItem,
)
```

合并：

```ts
export const DesktopRpcs = AppRpcs.merge(
  StorageRpcs, FileRpcs, WindowRpcs, MenuRpcs, EventRpcs, PluginRpcs, WorkbenchRpcs,
)
```

> 每次改这个文件，`packages/desktop` 都要跑 `bun typecheck`。

## 3. 渲染进程调用

```ts
// api-types.ts
workbench: {
  getState(input?: { force?: boolean }): Promise<WorkbenchSnapshot>
  saveSettings(input: { patch: Partial<WorkbenchSettings> }): Promise<WorkbenchSnapshot>
  validateToken(input: { token: string }): Promise<{ ok: boolean; memberName?: string; error?: string }>
  saveToken(input: { token: string }): Promise<WorkbenchSnapshot>
  clearToken(): Promise<WorkbenchSnapshot>
  importTokenFromBinding(): Promise<{ ok: boolean; error?: string }>
  rescan(): Promise<WorkbenchSnapshot>
  addManualItem(input: ManualItemInput): Promise<WorkbenchSnapshot>
  updateManualItem(input: { id: string; patch: Partial<ManualItemInput> }): Promise<WorkbenchSnapshot>
  removeManualItem(input: { id: string }): Promise<WorkbenchSnapshot>
}

// api.ts
workbench: {
  getState: (input) => invoke("WorkbenchGetState", { force: input?.force }),
  saveSettings: (input) => invoke("WorkbenchSaveSettings", input),
  …
}
```

Web 构建（无 Electron）时 `api.workbench` 为 `undefined`，`model.ts` 直接进入「桌面端专属」空状态，不抛错。

## 4. 快照示例

```json
{
  "settings": {
    "frontendServerUrl": "http://127.0.0.1:9522",
    "projectRoot": "/Users/user/Desktop/work/pier",
    "toolsRoot": "/Users/user/Desktop/work/pier/tools",
    "pollIntervalMs": 300000,
    "maxItems": 300,
    "includeWorktrees": true,
    "debugRaw": false,
    "projects": {
      "crew-web-vue-3.0": {
        "enabled": true,
        "main": "crew-web-vue-3.0",
        "worktrees": ["crew-web-vue-3.0-worktree"],
        "verifyProfile": "web-vue"
      }
    },
    "spaceBindings": {
      "space_1": { "projectKey": "crew-web-vue-3.0", "confirmed": true, "source": "manual" }
    }
  },
  "token": { "configured": true, "memberName": "潘学林", "userId": "u-1", "persistent": true },
  "sync": {
    "at": "2026-11-20T07:30:00.000Z",
    "durationMs": 4210,
    "ok": true,
    "partial": true,
    "warnings": [
      { "scope": "project", "key": "crew-portal", "code": "YUNXIAO_TIMEOUT", "message": "crew-portal 查询超时" }
    ]
  },
  "projects": [
    {
      "projectKey": "crew-web-vue-3.0",
      "airlineCodes": ["TG", "QQ"],
      "main": "crew-web-vue-3.0",
      "worktrees": ["crew-web-vue-3.0-worktree"],
      "resolvedWorkspace": "/Users/user/Desktop/work/pier/crew-web-vue-3.0",
      "exists": true,
      "isGitRepo": true,
      "gitRemote": "git@192.168.199.112:crew/java/crew-web-vue-3.0.git",
      "currentBranch": "auto-test",
      "envBranches": ["auto-test"],
      "dirty": false,
      "binding": "bound"
    }
  ],
  "items": [
    {
      "id": "wi-1",
      "source": "yunxiao",
      "serial": "TG-3223",
      "title": "Flight Log 附件上传后预览空白",
      "url": "https://devops.aliyun.com/...",
      "category": "Bug",
      "status": "待处理",
      "priority": "P1",
      "airlineCode": "TG",
      "spaceId": "space_1",
      "spaceName": "Crew Web 前端",
      "projectKey": "crew-web-vue-3.0",
      "branch": "auto-test",
      "createdAt": "2026-11-18T02:00:00.000Z",
      "updatedAt": "2026-11-20T06:00:00.000Z",
      "commentCount": 4,
      "attachmentCount": 2,
      "readiness": "partial",
      "reasons": [
        { "level": "pass", "code": "MAPPING_OK", "message": "项目、工作区、分支均已解析" },
        { "level": "risk", "code": "ACCEPTANCE_MISSING", "message": "缺少验收标准" }
      ],
      "missing": ["补充验收标准", "补充复现环境"],
      "mapping": {
        "projectKey": "crew-web-vue-3.0",
        "workspacePath": "/Users/user/Desktop/work/pier/crew-web-vue-3.0",
        "workspaceKind": "main",
        "workspaceCandidates": [
          { "path": "/Users/user/Desktop/work/pier/crew-web-vue-3.0", "kind": "main", "exists": true },
          { "path": "/Users/user/Desktop/work/pier/crew-web-vue-3.0-worktree", "kind": "worktree", "exists": false }
        ],
        "gitRemote": "git@192.168.199.112:crew/java/crew-web-vue-3.0.git",
        "currentBranch": "auto-test",
        "envBranch": "auto-test",
        "branchMatch": true,
        "dirty": false
      }
    }
  ],
  "counts": { "total": 12, "ready": 5, "partial": 3, "blocked": 4, "unbound": 2 }
}
```

## 5. 上游调用

主进程不直连云效域名，全部经 `frontend-server`（令牌走请求头）：

| 主进程方法 | 上游 | 说明 |
| --- | --- | --- |
| `userCurrent()` | `POST /agent-api/yunxiao/user/current` | 校验令牌 + 拿 userId / 名字 |
| `projects()` | `POST /agent-api/yunxiao/projects/list` | 空间列表 |
| `search(spaceId, category)` | `POST /agent-api/yunxiao/workitems/search` | `assignedTo: userId` |
| `context(id)` | `POST /agent-api/yunxiao/workitems/context` | 详情正文、关联、附件 |
| `comments(id)` | `POST /agent-api/yunxiao/workitems/context` | 同上一并返回 |
| `codeProjects()` | `GET /api/v1/code-projects` | 项目与默认分支 |
| `environments()` | `GET /api/v1/airline-environments?pageSize=500` | 航司 / 环境 / 分支 |

请求头：

```text
x-yunxiao-token: <token>
x-yunxiao-organization-id: <可选，服务端有默认>
content-type: application/json
```

- 超时 15s，`AbortController` 取消。
- 401 / 403 立即停止本轮，不重试。
- 429 记录 warning，本轮跳过该项目。
- 不把 token 写进 URL、不写进日志。

## 6. 错误

RPC 层失败用 `RpcClientError`；业务失败不抛，进 `sync`：

| code | 出现位置 | 界面 |
| --- | --- | --- |
| `SERVICE_UNREACHABLE` | `sync.warnings[scope=global]` | 「本地服务未连接」 |
| `TOKEN_MISSING` | `token.configured=false` | 引导配置 |
| `TOKEN_INVALID` | `sync.warnings[scope=global]` | 红条 + 重新配置 |
| `YUNXIAO_TIMEOUT` | `warnings[scope=project]` | 「N 个项目失败」 |
| `YUNXIAO_RATE_LIMIT` | 同上 | 琥珀条 + 退避提示 |
| `ROOT_MISSING` | `warnings[scope=global]` | 设置页高亮 |
| `PATH_OUTSIDE_ROOT` | `WorkbenchSaveSettings` 抛错 | 表单错误，不保存 |
| `TRUNCATED` | `snapshot` 附 `truncated` | 「只显示前 300 条」 |

## 7. 版本与兼容

- RPC 只在应用内部使用，没有对外兼容承诺，但同一版本内每加一个字段必须是 `optionalKey`。
- 快照结构变化时，`settings` / `manual-items` 要能在旧数据上解码：新增字段给默认值，不做破坏性重命名。
- V2 的新能力（创建任务、验证、推送）另开 `WorkbenchTask*` 组，不复用 V1 的 RPC。
