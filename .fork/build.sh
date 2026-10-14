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

# 只使用已安装依赖，禁止构建过程修改或还原用户的锁文件。
CLI_VERSION=$(bun -e 'console.log(require("./packages/cli/package.json").version)')

# 渠道会决定服务注册路径；拒绝把其他并发构建的 CLI 装进桌面包。
verify_cli() {
  bun "$REPO/.fork/verify-cli.ts" "$1" "$CLI_VERSION"
}

case "$1" in
  desktop)
    echo "[build] 构建 CLI（当前平台，version=$CLI_VERSION）"
    OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build --single --skip-install
    # 桌面端 prod/beta 渠道的 prebuild 会把 OPENCODE_CLI_DIST 指向的 CLI 拷进
    # resources/opencode-cli（packages/desktop/scripts/prebuild.ts）。fork 自用必须
    # 用我们自己构建的 CLI，否则界面是新的、服务端还是上游的。
    CLI_DIST="$REPO/packages/cli/dist"
    CLI_BINARY="$CLI_DIST/cli-darwin-$(uname -m | sed 's/x86_64/x64/')/bin/opencode"
    verify_cli "$CLI_BINARY"
    CLI_HASH=$(shasum -a 256 "$CLI_BINARY" | cut -d ' ' -f 1)
    echo "[build] electron-vite build（channel=prod, CLI=$CLI_DIST）"
    OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST="$CLI_DIST" bun run --cwd packages/desktop build
    verify_cli "$REPO/packages/desktop/resources/opencode-cli"
    echo "[build] electron-builder package:mac（CSC 关闭 → afterPack 做 ad-hoc 签名）"
    # 必须在 packages/desktop 下执行：electron-builder 可执行文件与 --config 都相对该目录解析。
    (cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true \
      OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST="$CLI_DIST" \
      ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
      npx electron-builder --mac --publish never --config electron-builder.config.ts)
    APP_DIRECTORY=mac
    if [ "$(uname -m)" = "arm64" ]; then APP_DIRECTORY=mac-arm64; fi
    PACKAGED_CLI="$REPO/packages/desktop/dist/$APP_DIRECTORY/OpenCode.app/Contents/Resources/opencode-cli"
    verify_cli "$PACKAGED_CLI"
    # 签名会改变二进制哈希，所以比较签名后的 resources 副本与 app 中的副本。
    cmp "$REPO/packages/desktop/resources/opencode-cli" "$PACKAGED_CLI"
    test "$CLI_HASH" = "$(shasum -a 256 "$CLI_BINARY" | cut -d ' ' -f 1)" || {
      echo "CLI 构建目录被并发修改，本次产物不可交付" >&2
      exit 1
    }
    codesign --verify --deep --strict "$(dirname "$(dirname "$(dirname "$PACKAGED_CLI")")")"
    echo "[build] 产物在 packages/desktop/dist/"
    ;;
  *)
    echo "[build] 构建 CLI（当前平台，version=$CLI_VERSION）"
    OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build --single --skip-install
    echo "[build] 产物在 packages/cli/dist/"
    ;;
esac
