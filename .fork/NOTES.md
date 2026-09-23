# fork 维护交接说明

这个仓库是 `anomalyco/opencode` 的 fork，用于长期维护自己的改动。

## 仓库与分支

- `origin` = `git@github.com:jianhao/opencode.git`（自己的 fork）
- `upstream` = `https://github.com/anomalyco/opencode.git`
- 直接在自己的 `dev` 上改，定期从 upstream 跟进：
  ```sh
  git fetch upstream
  git rebase upstream/dev      # 或 git merge upstream/dev，二选一，保持一致
  ```
- **约定：一个问题一个 commit**，commit message 用上游风格 `fix(scope): ...` /
  `feat(scope): ...`。这样以后要给上游提 PR，可以直接 `git cherry-pick` 单个 commit。

## 环境

| 项 | 值 |
|---|---|
| 上游版本（dev） | `1.18.32`（构建产物版本号形如 `0.0.0-dev-<timestamp>`） |
| bun | 需要 `^1.3.14`（本机已升到 1.4.2） |
| npm registry | 淘宝镜像。**这是关键**：普通 `bun install` 会把镜像 URL 写进 `bun.lock`，把 fork 弄脏 |

**装依赖一律用：**
```sh
bun install --frozen-lockfile
```

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

### 桌面端的两个坑（要用桌面端产物才需要处理）

1. `packages/desktop/electron-builder.config.ts` 里
   `publish: { provider: "github", owner: "anomalyco", ... }` + `electron-updater`
   → **fork 构建的 app 会去检查官方更新源，可能把自己替换回官方版**。要么改掉 publish，
   要么禁掉 updater。
2. `notarize: true` / `hardenedRuntime: true` 需要 Apple 签名证书。自用可以走
   `CSC_IDENTITY_AUTO_DISCOVERY=false` 出未签名包（脚本里已带）。

## 待办的三个改动

### (c) Markdown 图片点击不弹预览 —— patch 已提交，未运行时验证

- commit：`fix(session-ui): open markdown images in the in-app preview dialog`
- 文件：`packages/session-ui/src/components/markdown.tsx`（新增 `setupImagePreview()`，
  挂在 markdown 根节点做事件委托，命中 `HTMLImageElement` 时用现有 `useDialog()` 弹 `ImagePreview`）
- 为什么需要：用户消息附件有 `onClick → openImagePreview()`
  （`packages/session-ui/src/components/message-part.tsx:1237`、`:1282`），
  但 Markdown 渲染出的 `<img>` 没有任何点击处理，两者行为不一致
- **下一步：运行时验证**（上面「UI 改动怎么验证」），确认点击真的弹预览
- 上游：没搜到重复 issue。注意 CONTRIBUTING 说 UI 变更要先过设计评审，
  提 issue 时建议框成「行为不一致的 bug」而不是新功能

### (b) 插件加载/安装失败是静默的、且不重试 —— 未动

- 位置：`packages/opencode/src/plugin/index.ts:139`（`publishPluginError`）与 `:198-214`（`report.error` 分支）
- 现象：失败只 `publish` 一个 `Session.Event.Error`，**不写日志、不报给用户、不重试**。
  实例创建时那次失败之后，这个实例永久没有插件工具，新开会话也不会恢复（只能重启 app）
- 上游：issue **#41574** 是同一类问题，但只覆盖 **TUI 插件**路径；**server 插件**路径没有 issue
- 下一步：提 server 侧 issue（引用 #41574），修法是至少 `Effect.logError` 落到
  `opencode.log`，并让错误能到达用户

### (a) `@latest` 插件缓存不刷新（发新版用户拿不到） —— 未动

- 位置：`packages/core/src/npm.ts:133`（`existsSafe` 短路，已装就直接 return，从不重新解析 dist-tag）
- 上游：issue **#25293** 已 **closed as not_planned**；
  **PR #35777** 还开着（`packages/core/src/npm.ts` + 测试，+238/−11，自带 168 行测试），
  但 `mergeable: false / dirty` —— **跟 dev 有冲突，所以合不了**
- 另一版本 PR #37688 被机器人按「超 1 个月 + 少于 2 个 reaction」自动关闭
- 下一步（推荐）：把 #35777 rebase 到最新 dev → 本地跑 `bun test packages/core` →
  在 PR 下留言并给出 rebase 后的分支；作者不响应就开自己的 PR（body 里 `Closes #25293`
  并注明 based on #35777）

## 家另一台机器的起步步骤

```sh
git clone git@github.com:jianhao/opencode.git && cd opencode
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
bun install --frozen-lockfile
./.fork/build.sh
```
