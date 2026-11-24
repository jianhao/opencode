# fork CHANGELOG

记录**本 fork 自己**相对上游 `anomalyco/opencode` 做的功能与修复。
只列 fork 自己的 commit，上游同步进来的提交不在此列。
日期取提交日期；哈希是当时的短哈希（历史若被 rebase 过可能对上不）。

---

## 2026-11-24

### ✨ 云效工作台：任务层、阶段动作与人验收

- 新增桌面 SQLite 表 `workbench_task` / `workbench_run` / `workbench_event`（迁移 `20261124034207_workbench-tasks`）：
  一条云效单 + 一个本地目录 = 一个任务，可对应多次会话；审批与阶段流转留事件。
- 新增 RPC：`WorkbenchPreflight`、`WorkbenchTaskList`、`WorkbenchTaskStart`、`WorkbenchTaskSetStage`、
  `WorkbenchTaskBindRun`、`WorkbenchTaskApprove`、`WorkbenchTaskDocs`。
- 点「开始分析」先做 preflight：只有工作区真有改动才弹二次确认；确认后在
  `<项目>/.opencode/workbench/<serial>/` 生成 brief / plan / tasks / test-plan / acceptance 与 checkpoint
  （HEAD、diff、status），目录自带 `.gitignore`，不污染业务 diff。
- 规划会话只读（仅允许写规划目录），计划确认后放开写权限再执行；底栏按阶段给动作
  （规划：同意并执行 / 重新规划；执行：执行完成；待验收：验收通过），阶段只由人推进，不按会话空闲自动前进。
- 批准执行时补记一条 `execute` 运行记录；每次阶段变更由主进程往 `log.md` 追一行「阶段记录」，
  模型漏写日志也还有流水。卡片显示「规划中 / 待确认计划 / 执行中 / 执行待确认 / 待验收 / 已完成」。
- 修复：权限规则匹配的是「相对会话目录」的路径，而规划目录允许项用了绝对路径，导致 `write` / `edit` 全被拦、
  只能退化成 Shell heredoc；现在按相对路径下发 glob，首次规划和重新规划共用同一条创建路径。
- 新增 `packages/util/src/rich-text.ts`（云效富文本转块级结构）与 `dompurify` 依赖，详情正文按块渲染而不是整段 HTML。

### 🎨 图标套装收口：line / plate

- 三档 `linear / duotone / ink` 合并为两套 `line / plate`，默认 `line`；旧设置自动迁移（`duotone → plate`，其余 `→ line`）。
- 删除 `packages/ui/src/icons/new-icons.ts` 覆盖层，图标统一走 catalog，尺寸只由 `size`（20 / 16 / 14）决定。
- `plate` 给对象图标加同色浅底（`color-mix` 12%），负外边距抵消内边距，不改变 16px 占位。
- 会话标签头像改为统一 `bubble-5` + accent 浅底 + 未读点，不再按项目生成随机图案。
- 品牌资源（`packages/identity`、console brand、`services/www` favicon）一起更新；设计稿与盘点收进 `docs/图标主题方案/`。

## 2026-11-22

### ✨ 云效工作台 V1（只读控制台）

- Home 右栏新增「工作台 / 最近会话」切换，默认工作台；工作台包含今日聚焦、健康环、两条泳道和卡片墙。
- 主进程新增 workbench RPC 组与云效客户端：令牌用 `safeStorage` 加密落盘，读取走 `frontend-server /agent-api/yunxiao/*`。
- 工作项按项目 × 类别聚合，支持状态筛选配置、搜索、5 分钟轮询、手动刷新、手动添加工作项。
- 详情抽屉：当前工作项、正文（图片经代理转 data URL）、变更记录、评论、关联项；可复制云效号。

### 🎨 主题色与语义图标体系

- 新增 `glacier-mist` / `latte-violet` / `matcha-air` 三套主题，主题 token 覆盖图标与状态色。
- 图标 tone 从硬编码色改为语义 token（accent / info / success / warning / neutral），对象图标上色、动作图标保持中性。
- 外观设置新增「图标样式」，去掉实验开关 `newIcons`，旧设置自动迁移。

## 2026-11-20

### 🐛 会话目录不再回退到文件系统根

- 根因：V1 导入把 `global` 项目的 `worktree` 写成文件系统根（`/` 或 `C:/`）。它不是任何会话的目录，还会让
  `containsDirectory("/", 任意路径)` 成立，导致项目名显示成 `/`、项目归属判断把整个磁盘算作 global，
  从 Home/侧栏对该项目“新建会话”也会直接落在 `/`。
- 数据修复：新增迁移 `20261120120000_repair_global_project_root`，用 `worktree` 表里登记过的真实目录替换占位根；
  `Project.persist` 在解析到 global 的真实目录时也会替换仍为根的 canonical，覆盖迁移后再导入的旧库。
- 界面兜底：运行时把 global 的占位 worktree 换成已加载工作区清单里的真实目录；新建会话的选择器拒绝把文件系统根
  当作会话目录；Home/侧栏的新建会话再加一道根目录保护。
- 选择目录：桌面原生目录选择器带上当前会话目录作为起点（不再打开在上次位置或根目录）；切换项目时重置
  worktree/branch 选择，避免继承旧仓库的“新建 worktree”。
- 回归：`packages/util` 根目录判断、core 迁移与 `Project.resolve` 修复、app 路径/新建目标单测；e2e 覆盖
  “global 项目显示草稿目录并在切换项目后更新”。
- 桌面端打包后不生效的另一个原因：后台服务常驻（PPID 1），同版本重打包只会替换暂存 CLI，旧服务进程仍执行旧文件，
  版本匹配后又被复用。现在暂存副本被替换时写 `.restart` 标记，下次启动先停旧服务再拉起新进程；停止失败则保留标记重试。

## 2026-11-06

### ✨ 会话导航条首屏显示完整轮次

- 导航条不再从首屏已加载的 20 条消息推导轮次，而是单独分页读取 `user` 消息索引，因此打开旧会话即可看到全部导航点，又不加载完整正文。
- 点击尚未加载的历史轮次会走现有 cursor/history 流程，按需向前分页并定位到对应消息。
- 新增 `session-outline-data` 单测和 e2e：首屏 12 个导航点、点击最早一轮后加载正文。

### 🐛 纠错回复只回答变化部分

- 系统提示明确：上一轮回答只作为上下文，不作为本轮续写模板；用户纠错时只回答修改部分，不重开已经解决的问题。
- 移除“每节强制标题和 emoji”的固定模板要求，改为按请求选择合适的结构与段落。

### ✨ 执行过程先说明步骤并默认收起工具

- 系统提示改为：每批工具调用前用一句话说明要检查、执行或修改什么；不再静默调用工具，也不把原始命令当成回复正文。
- 工具执行完成后要求整理结论、修改内容和验证结果，而不是停在命令列表。
- 会话时间线中的过程组默认收起；组标题显示模型当前步骤说明，工具名称和数量作为次要信息，用户需要时再展开查看命令。

## 2026-10-14

### ✨ 会话导航条支持左侧/右侧设置（`9965fa2600`）

- 新增 `settings.general.outlineSide`（`left` / `right`，默认**右侧**），设置行在「时间轴」区块，
  也可通过设置搜索（`settings-outline-side`）找到。
- 横向布局全部由 CSS 驱动：基础保留逻辑属性（无 `data-side` 时跟随语言方向、RTL 自动镜像，
  这一形态给上游 PR 用），`[data-side]` 才按物理位置钉住——轨道贴边、tick 朝内容方向伸长、
  hover 卡片朝对话侧展开，不再被窗口边缘裁切。
- 顺手清掉 `session-outline.tsx` / `screen.tsx` 的 39 处 `require-readable-spacing` 警告。
- e2e：新增 `e2e/regression/session-outline.spec.ts`（默认右侧 + 几何位置、切左侧后移到左边缘、
  设置行只有左/右）。

### 🐛 修复巨型工作区上 diff 卡死导致会话白屏（`71e42e755a`）

- 现象：在 `/pier` 这类"全树未跟踪"的大仓库里切标签页时，**整屏聊天消失**（DOM 只剩 5 个节点的空面板），
  每约 60s 一轮；实测白屏时长正好等于 `/api/vcs/diff?mode=working` 请求的存活时间，屏蔽该请求后立即恢复。
- 根因：审查扩展的工作区 diff 查询没有初值，`@tanstack/solid-query` 的 `.data` 在 `state.data === undefined`
  时是**挂起读**（`queryResource()`），于是整条会话路由被 Suspense 换成空面板 —— 是"路由被卸载"，不是渲染卡死。
- 修复：
  - 两个 diff 查询带 `initialData`，渲染期不再读到挂起资源（这是白屏的开关）。
  - 新增 `ChangeStatus`（`idle`/`loading`/`ready`/`failed`）：加载失败显示"无法加载变更"，
    不再被读成"没有变更"；审查面板、侧栏、文件树 Changes 页签、会话详情变更行都按状态出文案。
  - 失败冷却：按**完整 query key**（目录/服务器/分支/模式）记录，只有真实扫描写时间，
    被拒绝的触发不会把冷却重新计时；冷却结束后下一次触发照常扫描。
  - 触发收口：关闭自动重试；刷新只 invalidate 当前模式与详情行的**确切 key**
    （原先按前缀刷新会取消其它模式在途的扫描）；两者共用 key 时只刷一次。
  - 会话路由 Suspense 的兜底由空面板换成 "Loading…"，便于区分"在加载"和"渲染没了"。
- 回归测试（`packages/app/e2e/regression/review.spec.ts`）：冷却不被自身触发刷新（含冷却结束后恢复扫描）、
  冷却按目录隔离（A 失败不影响切到 B，切回 A 仍守冷却）。

### 🐛 服务端 diff 增加执行预算（`c07c207e48`）

- 客户端 1 分钟就放弃的 diff，服务端仍会继续扫完整个工作区（大仓库上按未跟踪文件逐个
  `git diff --no-index`）。新增 `MAX_DIFF_DURATION`（45s，为客户端 60s 留余量），超时在 `review()`
  内部失败成 `Vcs.DiffError`，并随效应作用域结束**杀掉对应的 git 子进程**（实测子进程被清理）。
- 补测试：`Effect.never` 的 provider + `TestClock` 推进预算断言 `DiffError`；原"中断语义"用例仍通过。

### 🔧 打包时校验 CLI 渠道、版本、签名与副本一致（`2be889661b`）

- `build.sh` 不再 checkout 用户的 `bun.lock`（会静默丢弃锁文件改动），改用 `--skip-install` 只用已装依赖。
- 新增 `.fork/verify-cli.ts`：不启动服务，校验二进制内嵌的渠道/版本、`--version` 与 `opencode-cli.version`。
- `desktop` 流程断言 CLI 构建产物 → `resources/opencode-cli` → 打包后 app 内副本三处一致
  （签名会改哈希，比较签名后的两份），并用 sha256 确认构建目录未被并发构建改写。

## 2026-09-30

### ✨ 标签页右键支持「关闭其他标签页」

- 标签页右键菜单在「关闭标签页」之外新增「关闭其他标签页」：保留当前标签，关闭其余（含草稿页），并切到保留的标签。
- 被关闭的会话标签仍进入「最近关闭」栈，可照常恢复；新增文案 `common.closeOthers`（en/zh）。

### 🐛 调整消息折叠：只收过程旁白、保留答复（`14eb89d357`）

- `groupParts` 改为：文字/思考**后面还有工具调用**才折进活动组；**最后一个工具调用之后的文字**视为答复保留；**较长文本块（>300 字或 >3 行）不折**，避免吞掉中途的实质回答。
- 背景：上游 chat 模型没有 Codex 的 `commentary`/`final` channel（上游 issue #47168 尚未实现），只能启发式判定。

## 2026-09-29

### ✨ 渲染本地截图与工具附件（`b6c1947e99`）

- 新增 `/file/raw` 路由，把本地图片路径重写成可加载的 URL，绕过 Chromium / CSP 对 `file://` 的限制。
- 该路由仅允许回环访问，并限制路径白名单、图片扩展名与文件大小。
- session-ui 新增图片解析器，桌面端把本地图片指向 opencode 服务端；Markdown 与工具结果里的本地图片自动重写为缩略图，点击可预览。
- 工具产出的附件不再折叠，改为内联渲染，保证结果可见。

### ✨ handoff 交接会话功能（`903302c20e`）

- 服务端两个只读/建会话接口：`POST /session/:id/handoff/preview`（复用 compaction 摘要模板，用当前会话模型生成中文交接简报，不改会话）、`POST /session/:id/handoff/start`（当前目录新建 root 会话，标题加 `↪` 前缀、记 `metadata.handoffFrom`，把简报作为首条消息异步发出）。
- app 新增 `/handoff` 命令与预览弹窗（可编辑、生成中/失败态、跟随主题色），创建后自动切到新会话。
- 同步重新生成 SDK，并补 handoff 渲染单测。

## 2026-09-28

### ✨ 会话可读性优化：工具活动分组 + 语言/风格系统提示（`6cddaacd09`）

- 新增 `ToolActivityGroup`，把工具调用与中间叙述折叠成可展开分组，运行中默认自动展开；最终回答仍独立显示。
- 新增 `LANGUAGE_SYSTEM_PROMPT` / `STYLE_SYSTEM_PROMPT`，强制模型用用户语言、按「结论优先」的结构化风格回复。
- 明确 fork 只维护 `en`/`zh` 两种语言文案。

### 🎨 更新应用图标与网站图标（`f1b21981d6`）

- 统一替换 desktop `beta`/`dev`/`prod` 各环境的应用图标，并更新 docs、ui 的 favicon 等资源。

### ✨ 设置弹窗支持拖动、缩放并记忆位置（`4ab7f1efdd`）

- 新增 `packages/app/src/components/settings-v2/window.ts`，为设置弹窗提供拖动、缩放与位置/尺寸持久化。
- Dialog 组件暴露 `containerRef`；设置弹窗默认尺寸由放大 50% 调整为 85%，新增拖动条与缩放手柄样式。

### 🐛 调整 sidecar 代理初始化顺序（`d64f5f9970`）

- 把 `ensureLoopbackNoProxy` / `useEnvProxy` 移到动态导入 Server 之后，保证代理变量先加载再判断，避免虚拟模块加载前设置代理导致环境变量读取异常。

### 🔧 修复 fork 桌面端打包并支持插件配置原样键名（`e691cb0aa6`）

- `build.sh` 在 `packages/desktop` 下执行 electron-builder，并用 fork 自己构建的 CLI 覆盖内置 `opencode-cli`，避免桌面端嵌入上游服务端。
- Electron 下载走国内镜像兜底，解决 GitHub 直连超时。
- 解析插件 spec 时记录配置里的原样写法，`plugin_settings` 同时支持 `./plugin.ts` 与解析后的绝对路径；补相应测试。

## 2026-09-24

### ⚙️ 插件按策略更新 + 逐插件设置（`beb2989936`）

- core 提供 `auto`/`notify`/`off` 三种版本解析策略与 `plugin_settings` 配置；schema 新增 `plugin.updated` / `plugin.update_available` 事件。
- opencode 按策略加载并暴露 `Plugin.update`；server 新增 `POST /plugin/update`，且仅插件配置改动时不再全量 dispose 实例。
- app 新增插件设置页与更新提示；放宽 Web UI 的 CSP `img-src`（放行 `localhost`、`[::1]`）以便插件本地图片显示。
- 同步重新生成 SDK。

### 🎨 新增 purple-vibe 主题并修复主题下拉切换（`ce89ba504c`）

- 内置「紫色韵味」主题并注册导出。
- 修复主题下拉切换一次后无法再次展开（稳定 options 引用 + 按当前主题 keyed 重建 Select）。

### ⚙️ 启动时加载 `~/.config/opencode/.env`（`181eee8df2`）

- CLI 入口与桌面端 sidecar 入口加载 `~/.config/opencode/.env`（支持注释、`export` 前缀、引号），**不覆盖**真实环境变量，用于配置代理等全局变量。
- 注意：Bun 里 `"HTTPS_PROXY" in process.env` 恒为 true，改用读取值判断是否已存在。

### 📚 插件失败重试 + npm dist-tag 重新解析 + CSP 放行本地图片（`30f4fa88d7`）

- 修复 npm dist-tag 每次重新解析，避免插件发新版后客户端拿不到。
- 插件加载失败后按退避自动重试并补日志；插件工具改为每次读取时重新收集，确保恢复后可用。
- CSP 的 `img-src` 放行 `127.0.0.1` 任意端口，修复插件本地图片破图。
- 补充相应测试，并新增 fork 维护经验总结。

## 2026-09-23

### 🧩 fork 构建脚本与维护说明（`3383d5508c`）

- 新增 `.fork/build.sh`（CLI / 桌面端打包）与 `.fork/NOTES.md`（fork 维护交接）。

### 🐛 Markdown 图片点击打开应用内预览（`ee29fc671e`）

- Markdown 渲染出的 `<img>` 之前无点击处理，与用户消息附件行为不一致；改为在 markdown 根节点做事件委托，命中图片时用现有 `useDialog()` 弹 `ImagePreview`。
