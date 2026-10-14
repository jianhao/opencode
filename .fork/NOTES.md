# fork 维护交接说明

这个仓库是 `anomalyco/opencode` 的 fork，用于长期维护自己的改动。

## 仓库与分支

- `origin` = `git@github.com:jianhao/opencode.git`（自己的 fork）
- `upstream` = `https://github.com/anomalyco/opencode.git`
- **`dev` 是本 fork 的主线**（v2 线，2026-10-14 由 `v2-port` 改名而来），直接在上面改，定期从 upstream 跟进：
  ```sh
  git fetch upstream
  git merge upstream/dev       # 本 fork 统一用 merge（见下方「同步 upstream」）
  ```
- `dev-v1` = 旧 v1 线（`60184a065b`，即 `origin/dev` 现在指向的提交）：**只作存档**，
  不要再往上提交，也不要把它和 `upstream/dev` 合并（上游在 2026-10-10 已把 dev 换成 v2，两条线包结构不同）。
- **约定：一个问题一个 commit**，commit message 用上游风格 `fix(scope): ...` /
  `feat(scope): ...`。这样以后要给上游提 PR，可以直接 `git cherry-pick` 单个 commit。
- **约定：新增功能时，同一次改动里就更新 `.fork/CHANGELOG.md`**（不必单独开 docs commit，
  代码 + 文档一起提交，历史更短）。

## 环境

| 项 | 值 |
|---|---|
| 上游版本（dev） | `2.0.28`（v2 线；跟着合并自动同步） |
| bun | 需要 `^1.3.14`（本机已升到 1.4.2） |
| npm registry | 淘宝镜像。**这是关键**：普通 `bun install` 会把镜像 URL 写进 `bun.lock`，把 fork 弄脏 |

**装依赖一律用：**
```sh
bun install --frozen-lockfile
```

## 同步 upstream（每次合并的流程与注意事项）

```sh
git fetch upstream
git merge upstream/dev
```

**合并后必做：**

1. `bun install --frozen-lockfile` —— 上游常带新依赖/版本号（例如 core 新增了 `open`）。
   漏了会 typecheck 报 `Cannot find module 'xxx'`。
2. `bun turbo typecheck` —— pre-push 钩子也会跑，本地先确认通过。
3. 动到服务端/界面时重建产物（见「构建」）；用桌面端就重打 prod 包。

**注意事项：**

- `bun.lock`：只允许 `--frozen-lockfile`；普通 `bun install` 会把淘宝镜像 URL 写进 lock。
- 上游多数提交是官方营销站/文档（`packages/web`、`packages/console`、`packages/stats`），
  我们**不构建**这些包，合并进来无影响，只是 diff 很大。
- 合并前可先 dry-run 看有没有冲突：`git merge-tree --write-tree dev upstream/dev`。
- **冲突按上游语义逐处解决，不能无脑 `--ours`/`--theirs`**，分情况：
  - 上游修 bug/改行为：先读上游意图，再把 fork 改动重放上去；明显是上游修复时优先接受上游。
  - i18n：只维护 `en`/`zh`，其它语言文件的冲突直接取上游。
  - `bun.lock` 冲突：别手动拼，`git checkout --theirs bun.lock` 后重新
    `bun install --frozen-lockfile` 最稳。
  - `.fork/`、`AGENTS.md`、桌面图标等 fork 自有内容：保留我们的版本。
  - 解完跑一遍 typecheck，再本地起服务/UI 冒烟验证。

## 构建

```sh
./.fork/build.sh              # CLI 二进制（内嵌 Web UI）
./.fork/build.sh --skip-ui    # 只改服务端时更快
./.fork/build.sh desktop      # 桌面端（未签名、不发布）
```

产物：
- CLI：`packages/opencode/dist/opencode-darwin-arm64/bin/opencode`（约 138MB，含 bun runtime + 内嵌 Web UI）
- 桌面端：`packages/desktop/dist/`

已验证：CLI 构建 ✅ 冒烟测试通过 ✅ 内嵌 Web UI 可访问（起 `serve` 后 `GET /` 返回前端资源）✅

### UI 改动怎么验证（不用打包 Electron）

```sh
# 方式 A：开发态热更
bun dev serve                         # 终端 1
bun run --cwd packages/app dev        # 终端 2 → http://localhost:5173

# 方式 B：用构建产物
./.fork/build.sh
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode serve --port 4321
```

### 桌面端打包与自动更新（重要）

**更新源**：`packages/desktop/electron-builder.config.ts` 里 prod/beta 有
`publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" }`。
打包后 `Contents/Resources/app-update.yml` 就指向**官方仓库**，app 启动时会自动查官方最新
release，比本地新就**静默下载**并在右上角显示安装按钮（**误点会把自己替换成官方版**）。
（dev 渠道没有 `publish`，`UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"` 为 false，
所以 dev 包没有这个问题。）

**本 fork 的策略：版本对齐（方案 D）**——不关更新，只让本地版本 = 官方最新：

- `merge upstream/dev` 会把版本号自动带到官方最新（`packages/desktop/package.json`），
  重打 prod 包后版本一致 → updater 比对相等 → 显示「已是最新」，不再弹按钮。
- ⚠️ **官方一发新 release，就尽快 `merge` + 重打 prod 桌面端**；这之间的时间窗里按钮在
  且已下载，注意别误点安装（会装成官方版、覆盖 fork）。
- ⚠️ **别把版本号手动改得比官方高**：`updater.ts` 有 `allowDowngrade = true`，本地版本
  高于官方时反而会提示「降级安装官方版」。
- 想彻底不弹（一劳永逸）：把 `packages/desktop/src/main/constants.ts` 的
  `UPDATER_ENABLED` 改成 `false`，或删掉 prod/beta 的 `publish`。

**打 prod 桌面端（保持 “OpenCode.app” 名字与 prod 图标，必须带 `OPENCODE_CHANNEL=prod`）**：

```sh
OPENCODE_CHANNEL=prod ./.fork/build.sh desktop
```

产物：
- 未打包 app：`packages/desktop/dist/mac-arm64/OpenCode.app`
- 安装包：`packages/desktop/dist/opencode-desktop-mac-arm64.dmg`（+ `.zip`）
- 不带 channel 时出的是 dev 版 “OpenCode Dev.app”（无更新源）。

注意：prod 桌面端**不内嵌** `resources/opencode-cli`，服务端是构建时用
`prebuild`（`packages/opencode/script/build-node.ts`）重打的 `dist/node` 打包进 asar 的。
所以 `./.fork/build.sh desktop` 一步即可同时更新界面和服务端；`opencode-cli` 只在
dev / v2 sidecar 用。

`notarize: true` / `hardenedRuntime: true` 需要 Apple 证书；自用走
`CSC_IDENTITY_AUTO_DISCOVERY=false` 出未签名包（脚本里已带）。

## 国际化（i18n）策略

- 本 fork **只维护 `en` 和 `zh`** 两套文案。
- 新增/修改文案只动 `en` + `zh`（`packages/ui/src/i18n/`、`packages/app/src/i18n/`、必要时 `packages/desktop/src/renderer/i18n/`）。
- **不要**去改其它语言文件（am/ar/de/ja/ko/zht/...）。运行时 locales 是「英文 base + 各语言覆盖」合并，缺 key 自动回退英文，功能不受影响。
- 不要为了让 `packages/app/src/i18n/parity.test.ts` 变绿去补其它语言；非维护语言的 parity 不强制。
- 背景：有一次改动把新 key 批量注入到 60+ 语言文件，产生大量无意义 diff，已整体回退。

## fork 自己的改动

本 fork 相对上游做的功能/修复，按日期列在 [`CHANGELOG.md`](./CHANGELOG.md)。

## 家另一台机器的起步步骤

```sh
git clone git@github.com:jianhao/opencode.git && cd opencode
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
bun install --frozen-lockfile
./.fork/build.sh
```

## v1 → v2 移植状态（2026-10-14）

上游在 2026-10-10 用 `chore: promote v2 to dev`（`5caf1f9f6f`）把整条 v2 线并进 `dev`，是一次
**整仓重写**：monorepo 重排（`packages/opencode` → `cli`/`server`/`ai`/…，`app/src` 目录全改）
＋ 存储 v1→v2（`session` → `session_v2`）。

处理经过：fork 先在临时分支 `v2-port`（基于 `upstream/dev`）上逐功能移植，**2026-10-14 移植告一段落，
把 `v2-port` 改名为 `dev` 作为主线**，旧 v1 线保留为 `dev-v1`。因此现在：

- `dev` 与 `upstream/dev` 同为 v2 线，`git merge upstream/dev` 恢复为正常流程。
- `dev-v1`（v1）与 `upstream/dev`（v2）**不可合并**，合并会得到新旧包并存的坏树。

**已移植（现 `dev`）：**
- 会话右侧对话导航条
- purple-vibe 主题 + fork 图标
- 标签页右键「关闭其他标签页」
- `~/.config/opencode/.env` 启动加载
- 系统提示：强制同语言回复 + 回复风格（`packages/core/src/session/fork-prompts.ts`）
- handoff 交接会话：**改为纯前端实现**（用现有 `session.generate/create/prompt`，不新增/覆盖上游路由）
- `.fork/build.sh`、维护文档、ad-hoc 签名钩子

**丢弃（v2 已覆盖 / 场景消失）：**
- 设置弹窗拖动/缩放（v2 设置已改为整屏路由 `settings/surface.tsx`）
- sidecar 代理顺序修复（v2 桌面端不再进程内 import server）
- 本地截图/工具附件、markdown 图片预览（v2 内置 `session-ui/markdown-image.ts`、`image-preview.tsx`）
- 插件「按策略更新」（v2 已有 `plugin add/check/update/remove` + server `plugin.update`）

**待定：**
- （可选）插件「逐插件 autoupdate 策略」：v2 未提供，如确实需要再单做。

**已补齐（v2 上的分叉改动）：**
- 消息分组/可读性：已移植 Codex 风格「最终回答之前的过程内容（工具 + 中间叙述）折叠为一组」，
  落在 `packages/session-ui/src/timeline/projection.ts`（`groupContent` 的 `answerIndex` 折叠）+
  `session-timeline-row.tsx`（组内渲染 text）+ `tools/tool-renderer.tsx`（`ContextGroupPart` 支持 text）。
- 语言/风格系统提示：并入 `SessionSystemPrompt.render()`（`withFork`），不再被模型族提示
  （`plugin/optimize.ts` 的 gpt/claude/kimi/... 覆盖）冲掉；并强化了「所有输出含工具间短状态行都必须用用户语言」。

**注意：** `.fork/build.sh` 已按 v2 结构重写（`packages/cli` 构建 CLI → `OPENCODE_CLI_DIST` → 桌面打包），
并在 2026-10-12 实跑通过：CLI `v2.0.27`（含 `session_v2` 存储，可与官方共用 `opencode.db`）、
桌面端 `2.0.27`、ad-hoc 签名 `codesign --verify --deep --strict` 通过。
构建 CLI 时会用 `OPENCODE_VERSION=<cli/package.json 的 version>` 固定版本号（否则会得到
`0.0.0-<branch>-<时间>` 的预览版号）。

**关键：内置 CLI 必须用 `OPENCODE_CHANNEL=latest` 构建**（不是 `prod`）。桌面端启动时
`Service.ensure({ file: undefined })` 会去读客户端默认的注册文件 `~/.local/state/opencode/service.json`
（见 `@opencode/client` 的 `fallback()`）；而 CLI 注册的注册文件名由它自己的 channel 决定
（`ServiceConfig.filename()`）：
- `latest`/`dev`/`beta`/`next` → `service.json`、默认端口 `0xc0de`
- 其它（如 `prod`）→ `service-<channel>.json`、`10000+hash(channel)%50000` 端口

用 `prod` 构建时 CLI 会注册 `service-prod.json`，桌面端却一直探测 `service.json` → 永远找不到服务
→ 报 `Timed out waiting for the background service to start`，卡在启动界面。官方发布的 CLI 就是用
`latest` 构建的，所以 fork 也必须用 `latest`（DB 仍是 `opencode.db`，不受影响）。
