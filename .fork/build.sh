#!/bin/sh
# 构建 fork 版 opencode（放在仓库内，方便多台机器共用）
#
#   ./.fork/build.sh            # 只构建 CLI 二进制（已内嵌 Web UI），快速
#   ./.fork/build.sh --skip-ui  # 跳过重建 Web UI（只改服务端/CLI 时用）
#   ./.fork/build.sh desktop    # 构建并打包桌面端（未签名，不发布）
#
# 依赖安装必须用：
#   bun install --frozen-lockfile
# 普通 `bun install` 会把 registry 地址（淘宝镜像）写进 bun.lock，把 fork 弄脏。
# 构建过程本身也会 bun add 一些构建期依赖，同样会改 bun.lock，所以退出时自动还原。

set -e

REPO=$(cd "$(dirname "$0")/.." && pwd)
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/')
BIN="$REPO/packages/opencode/dist/opencode-$PLATFORM/bin/opencode"

cd "$REPO"

restore_lock() {
  if ! git diff --quiet -- bun.lock 2>/dev/null; then
    git checkout -- bun.lock && echo "[build] bun.lock 已还原"
  fi
}
trap restore_lock EXIT

case "$1" in
  desktop)
    echo "[build] electron-vite build"
    bun run --cwd packages/desktop build
    # 桌面端 dev 渠道的 prebuild 会从 registry 下载上游 CLI 当内置服务端
    # （packages/desktop/scripts/prebuild.ts -> downloadCliToResources）。
    # fork 自用必须换成我们自己构建的那个，否则界面是新的、服务端还是上游的。
    FORK_CLI="$REPO/packages/opencode/dist/opencode-$PLATFORM/bin/opencode"
    if [ -f "$FORK_CLI" ]; then
      cp "$FORK_CLI" "$REPO/packages/desktop/resources/opencode-cli"
      chmod +x "$REPO/packages/desktop/resources/opencode-cli"
      [ "$(uname -s)" = "Darwin" ] && codesign --force --sign - "$REPO/packages/desktop/resources/opencode-cli" 2>/dev/null
      echo "[build] 已用 fork CLI 覆盖 bundles 内的 opencode-cli"
    else
      echo "[build] 警告：没找到 fork CLI（先跑一次 ./.fork/build.sh），桌面端仍会内嵌上游 CLI"
    fi
    echo "[build] electron-builder package:mac（未签名、不发布）"
    # 必须在 packages/desktop 下执行：electron-builder 可执行文件与 --config 都相对该目录解析。
    # ELECTRON_MIRROR 兜底走国内镜像，GitHub 直连经常超时；需要时可自行覆盖该变量。
    (cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true \
      ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
      npx electron-builder --mac --publish never --config electron-builder.config.ts)
    echo "[build] 产物在 packages/desktop/dist/"
    ;;
  *)
    ARGS="--single"
    [ "$1" = "--skip-ui" ] && ARGS="$ARGS --skip-embed-web-ui"
    echo "[build] script/build.ts $ARGS"
    bun ./packages/opencode/script/build.ts $ARGS
    echo "[build] 产物: $BIN"
    ;;
esac
