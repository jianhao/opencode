# 云效工作台 · opencode 桌面端方案

> 目标端：`pier/tools/opencode`（Electron + SolidJS 桌面端）
> 状态：设计待确认，V1 未开工
> 日期：2026-11-20
> 目录：`pier/tools/opencode/docs/工作台无人值守 Agent/`

## 1. 一句话

在 opencode 桌面端的首页里加一个「云效工作台」：打开应用就看到指派给我的云效工作项、落到哪个本地项目/分支、能不能直接开工；默认 5 分钟刷新，可手动刷新；也支持手动加一条工作项。

V1 只读。V2 才改代码、验证、推送/发布。当前阶段是「人在环控制台」，不是无人值守。文件夹名保留「无人值守 Agent」，是因为后续要往那个方向演进。

## 2. 位置决策：放在 Home，不新开一级路由

桌面端 `Home` 已经挂在 `/`，是启动后第一屏（`packages/app/src/shell/routes/routes.tsx`）。所以工作台直接做成 Home 的右栏视图：

```text
Home 面板
├─ 左栏  项目列表（现有 HomeProjects，240–280px）   ← 不动
└─ 右栏  [ 工作台 | 最近会话 ]                       ← 新增切换
         ├─ 工作台（默认）
         └─ 最近会话（现有 HomeSessions，原样保留）
```

- 默认视图 = 工作台，满足「一进来就看到」。
- 「最近会话」一键切回，现有会话能力一点不丢。
- titlebar 的 Home 按钮语义不变，不新增第二个入口。
- 工作台视图把内容宽度从 `max-w-[1080px]` 放开到满宽，`home/route.tsx` 的 grid 按视图切换。

不新开 `/workbench` 的理由：Home 本来就是「一进来看到」的位置；再加一个一级路由会多一个入口、多一次导航，还和 titlebar 的 Home 语义冲突。代价只是 Home 要支持两种宽度，这个改动集中在 `home/route.tsx` 一个文件。

## 3. 关键决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 入口 | Home 右栏默认「工作台」视图 | 打开即见，不新增路由/入口 |
| 渲染层 | `packages/app/src/workbench/` 新模块，SolidJS + `--v2-*` token | 复用现有 UI 语言，明暗/自定义主题自动适配 |
| 数据通道 | renderer → 主进程 RPC → `frontend-server /agent-api` | 不把云效 token 暴露给渲染进程，不跨域 |
| 令牌存储 | Electron `safeStorage` 加密后写 `userData/workbench/token.bin` | token 是凭据，不能明文进 SQLite |
| 配置存储 | 桌面 SQLite `state` 表，namespace `workbench` | 复用 `drafts.sqlite`，不新增散落 JSON |
| 云效读取 | 复用 `frontend-server` 的 `/agent-api/yunxiao/*` | 不重写云效客户端，沿用现有令牌与组织 |
| 项目根目录 | 可配置，默认 `/Users/user/Desktop/work/pier` | 工作相关都在一个根下，工具在 `pier/tools` |
| 项目映射 | `code_projects` + `airline_environment` + 本地 git 扫描；一个项目多路径（main + worktree） | worktree 要能独立开工 |
| 可做性 | V1 确定性规则（映射/分支/缺失信息），不接 LLM | 快、便宜、可解释；LLM 放 V2 |
| 轮询 | 渲染进程 5 分钟，页面隐藏暂停，失败退避，手动刷新 | 只有可见窗口需要新鲜数据 |
| V1 范围 | 只读：拉取、分组、详情、映射、手动项、轮询 | 先把「看得清」做对 |
| V2a | worktree + opencode 会话 + diff + 验证 | 改动隔离、可回滚、有证据 |
| V2b | push / MR / 云效评论草稿 / 受控发布 | 不可逆动作留给人 |

## 4. 端到端形态

```text
┌──────────────────────────────────────────────────────────────────┐
│ Renderer（packages/app/src/workbench）                            │
│  Home 视图切换 · 列表/详情 · 筛选 · 5 分钟定时器 · 本地偏好        │
└───────────────┬──────────────────────────────────────────────────┘
                │ window.electron.workbench.*（Effect RPC over IPC）
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Electron 主进程（packages/desktop/src/main/workbench）             │
│  ├─ 令牌：safeStorage 加解密                                       │
│  ├─ 配置：SQLite state / namespace=workbench                       │
│  ├─ 云效：HTTP → frontend-server /agent-api/yunxiao/*              │
│  ├─ 本地：realpath 校验 + 只读 git 命令（branch / remote / dirty）  │
│  ├─ 映射：space → projectKey → main/worktree → branch              │
│  └─ 缓存：内存 60s，手动刷新穿透                                   │
└───────────────┬───────────────────────────┬──────────────────────┘
                ▼                           ▼
   frontend-server（本地 9522）        本地项目根目录
   ├─ 云效 OpenAPI 代理                 /Users/user/Desktop/work/pier
   ├─ airline_environment                   ├─ crew-web-vue-3.0
   └─ code_projects                         ├─ crew-app-front-3.0
                                            └─ crew-app-front-3.0-worktree
```

`frontend-server` 默认地址 `http://127.0.0.1:9522`，可在工作台设置里改。未启动时工作台显示「本地服务未连接」，不静默失败。

## 5. 文档索引

| 文档 | 内容 |
| --- | --- |
| [01-产品与交互.md](./01-产品与交互.md) | 入口、Home 布局、统计条、列表、详情、手动添加、视觉规范、状态 |
| [02-技术架构与数据模型.md](./02-技术架构与数据模型.md) | 目录结构、RPC、存储、数据模型、项目解析、轮询、安全、测试 |
| [03-API契约.md](./03-API契约.md) | RPC 定义、快照结构、设置/令牌/手动项、云效上游调用 |
| [04-实施路线与验收.md](./04-实施路线与验收.md) | V1 任务拆解与工时、验收清单、V2a/V2b 范围、里程碑 |
| [05-风险与待确认.md](./05-风险与待确认.md) | 待拍板问题、技术/产品风险、依赖、spike |
| [workbench-preview.html](./workbench-preview.html) | 新版设计稿：左菜单 + 状态色任务卡片 + 右侧详情（明暗双主题，可交互） |
| [workbench-mockup.html](./workbench-mockup.html) | 上一版原型（左栏项目 + 密集列表），仅作对比保留 |
| [project-mapping.example.json](./project-mapping.example.json) | 7 个项目 + worktree 的映射示例 |

## 6. V1 做什么

1. `Home` 右栏加「工作台 / 最近会话」切换，默认工作台，选择持久化。
2. 主进程新增 `workbench` RPC 组 + service，渲染进程只调 RPC。
3. 令牌：录入、`safeStorage` 加密落盘、启动解密、`user/current` 校验。
4. 拉取：`user/current` → `projects/list` → 按项目 × 类别 `workitems/search`，只取指派给我、未完成。
5. 映射：`spaceBindings` / `code_projects` / `airline_environment` + 本地 git 只读扫描；一个项目支持 main + 多个 worktree。
6. 可做性：确定性三态（可做 / 需澄清 / 阻塞）+ 原因 + 缺失信息。
7. 手动工作项：新增 / 编辑 / 删除，和云效项合并展示并明确标记来源。
8. 界面：统计条、筛选、紧凑列表、右侧详情（概览 / 映射 / 上下文 / 评论）。
9. 刷新：5 分钟定时、页面隐藏暂停、手动刷新、失败退避、stale 提示。
10. 设置：项目根目录、工具目录、`frontend-server` 地址、轮询间隔、项目路径绑定。

明确不做：

- 不改代码、不建 worktree、不启动 opencode 会话。
- 不做服务端常驻轮询、不做推送通知。
- 不自动切分支、不自动 clone。
- 不写云效（不改状态、不发评论）。
- 不接 LLM 判可做性。

## 7. V2 做什么

**V2a 改 + 验**：选中一条单 → 建 worktree + 分支 + opencode 会话 → 实时看工具调用和文件变更 → 按项目 profile 跑 lint/typecheck/unit/build → 人工看 diff 与证据包，接受/重跑/放弃。

**V2b 推 + 发布**：push 非保护分支、创建 MR、云效评论先草稿后人工确认；「发布」是人工点击后触发项目预配置流水线，默认关闭，不做自动部署。

## 8. 估时

| 阶段 | 内容 | 估时（单人） | 出口 |
| --- | --- | --- | --- |
| V1.0 | RPC + 云效聚合 + 映射 + 工作台界面 + 轮询 | 10–12 人日 | 20 条真实单看全，映射不猜，无阻塞报错 |
| V1.1 | 设置页打磨 + 手动项 + 空/错状态 + 窄窗 | 3–4 人日 | 所有启用项目「已绑定或明确未绑定」 |
| V2a | worktree + opencode + diff + 验证 | 15–20 人日 | 3 条真实需求走完改+验 |
| V2b | push/MR + 云效草稿 + 审计 + 受控发布 | 8–12 人日 | 1 条 MR 全链路，0 越权 |

V1 合计 13–16 人日，±30%。拆解见 [04-实施路线与验收.md](./04-实施路线与验收.md)。

## 9. 三条硬约束

1. **不猜**：项目、目录、分支解析不到就显示「未绑定 / 待确认」，不允许补一个看起来合理的值。
2. **不阻塞**：单个项目拉取失败不影响其他项目，界面显示「部分数据 + 警告」。
3. **不越权**：V1 只读；V2 的推送、发布、云效写回都必须人工确认并留审计。

## 10. 下一步

1. 确认 [05-风险与待确认.md](./05-风险与待确认.md) 里的 4 个问题。
2. 先做两个 spike：云效 7 项目 × 3 类别聚合耗时；20 条真实单的项目/分支解析准确率。
3. spike 通过后按 [04-实施路线与验收.md](./04-实施路线与验收.md) 的 V1.0 开工。
4. 视觉先看 [workbench-mockup.html](./workbench-mockup.html)，对齐后再落 Solid 组件。
