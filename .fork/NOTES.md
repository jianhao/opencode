# fork 维护交接说明

这个仓库是 `anomalyco/opencode` 的 fork，用于长期维护自己的改动。

## 仓库与分支

- `origin` = `git@github.com:jianhao/opencode.git`（自己的 fork）
- `upstream` = `https://github.com/anomalyco/opencode.git`
- 直接在自己的 `dev` 上改，定期从 upstream 跟进：
  ```sh
  git fetch upstream
  git merge upstream/dev       # 本 fork 统一用 merge（见下方「同步 upstream」）
  ```
- **约定：一个问题一个 commit**，commit message 用上游风格 `fix(scope): ...` /
  `feat(scope): ...`。这样以后要给上游提 PR，可以直接 `git cherry-pick` 单个 commit。

## 环境

| 项 | 值 |
|---|---|
| 上游版本（dev） | `1.18.33`（= 官方最新 release；跟着合并自动同步） |
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
