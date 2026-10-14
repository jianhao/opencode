# fork CHANGELOG

记录**本 fork 自己**相对上游 `anomalyco/opencode` 做的功能与修复。
只列 fork 自己的 commit，上游同步进来的提交不在此列。
日期取提交日期；哈希是当时的短哈希（历史若被 rebase 过可能对上不）。

---

## 2026-10-14

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
