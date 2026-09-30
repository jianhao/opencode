# fork CHANGELOG

记录**本 fork 自己**相对上游 `anomalyco/opencode` 做的功能与修复。
只列 fork 自己的 commit，上游同步进来的提交不在此列。
日期取提交日期；哈希是当时的短哈希（历史若被 rebase 过可能对上不）。

---

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
