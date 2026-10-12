#!/bin/sh
# 构建 fork 版 opencode（v2 结构，放在仓库内方便多台机器共用）
#
#   ./.fork/build.sh            # 只构建 CLI（当前平台）
#   ./.fork/build.sh desktop    # 构建 CLI 并打包桌面端（未签名 ad-hoc，不发布）
#
# 依赖安装必须用：
#   bun install --frozen-lockfile
# 普通 `bun install` 会把 registry 地址（淘宝镜像）写进 bun.lock，把 fork 弄脏。

set -e

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"

restore_lock() {
  if ! git diff --quiet -- bun.lock 2>/dev/null; then
    git checkout -- bun.lock && echo "[build] bun.lock 已还原"
  fi
}
trap restore_lock EXIT

case "$1" in
  desktop)
    CLI_VERSION=$(bun -e 'console.log(require("./packages/cli/package.json").version)')
    echo "[build] 构建 CLI（当前平台，version=$CLI_VERSION）"
    OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build
    # 桌面端 prod/beta 渠道的 prebuild 会把 OPENCODE_CLI_DIST 指向的 CLI 拷进
    # resources/opencode-cli（packages/desktop/scripts/prebuild.ts）。fork 自用必须
    # 用我们自己构建的 CLI，否则界面是新的、服务端还是上游的。
    CLI_DIST="$REPO/packages/cli/dist"
    echo "[build] electron-vite build（channel=prod, CLI=$CLI_DIST）"
    OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST="$CLI_DIST" bun run --cwd packages/desktop build
    echo "[build] electron-builder package:mac（CSC 关闭 → afterPack 做 ad-hoc 签名）"
    # 必须在 packages/desktop 下执行：electron-builder 可执行文件与 --config 都相对该目录解析。
    (cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true \
      OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST="$CLI_DIST" \
      ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
      npx electron-builder --mac --publish never --config electron-builder.config.ts)
    echo "[build] 产物在 packages/desktop/dist/"
    ;;
  *)
    CLI_VERSION=$(bun -e 'console.log(require("./packages/cli/package.json").version)')
    echo "[build] 构建 CLI（当前平台，version=$CLI_VERSION）"
    OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build
    echo "[build] 产物在 packages/cli/dist/"
    ;;
esac
