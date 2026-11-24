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
HOST_ARCH=$(uname -m | sed 's/x86_64/x64/')

# 构建器输出太碎，全量落日志；终端只留大步骤、关键行和实时耗时。
TMP_ROOT="${TMPDIR:-/tmp}"
LOG_DIR="${TMP_ROOT%/}/opencode-pack-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
BUILD_STARTED=$(date +%s)
log_index=0

# 终端只留白名单里的进展行 + 报错行；警告、chunk 表、插件耗时全部留在日志里。
ERROR_PATTERN='^⨯|^✖|^error:|^Error:|^ERROR|^error '

format_duration() {
  seconds=$1
  if [ "$seconds" -lt 60 ]; then
    printf '%ss' "$seconds"
  else
    printf '%sm%ss' "$((seconds / 60))" "$((seconds % 60))"
  fi
}

# ora 同款 braille 旋转器；都是单码位，不会在终端里掉成灰色文字字形。
SPINNER_FRAMES='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏'

spin_frame() {
  index=0
  for frame in $SPINNER_FRAMES; do
    if [ "$index" -eq "$1" ]; then
      printf '%s' "$frame"
      return 0
    fi
    index=$((index + 1))
  done
}

# 进度行：旋转器 + 当前动作 + 耗时 + 步骤描述；重定向到文件或 CI 时不输出。
draw_progress() {
  [ -t 1 ] || return 0
  printf '\r\033[K   %s %s中 %ss · %s' "$1" "$2" "$3" "$4"
}

clear_progress() {
  [ -t 1 ] || return 0
  printf '\r\033[K'
}

# 进度条会反复用 \r 覆盖同一行，先拆行去缩进再按锚定规则过滤，避免子串误匹配。
# 剩下的每条都用 ✅ 打头，去掉构建器自己的 • 项目符号。
print_key_lines() {
  tr '\r' '\n' <"$1" |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' |
    grep -E "$2" |
    grep -v -E '\[[=#>-]*\] *[0-9]+%' |
    sed -e 's/^• *//' -e 's/^✓ *//' |
    awk 'NF && !seen[$0]++' |
    head -n 12 |
    sed 's/^/   ✅ /'
}

# run_step <动作> <步骤描述> <关键行匹配> <命令...>
# 命令在后台跑，前台只刷新一行进度；失败时把日志尾部打出来再退出。
run_step() {
  verb=$1
  label=$2
  pattern=$3
  shift 3
  log_index=$((log_index + 1))
  log="$LOG_DIR/step-$log_index.log"
  started=$(date +%s)
  description=${label#* }

  printf '\n%s\n' "$label"
  "$@" </dev/null >"$log" 2>&1 &
  pid=$!

  # 0.1s 轮询：每个 tick 换一帧旋转器，耗时按真实秒数算，不会越跑越偏
  ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    draw_progress "$(spin_frame $((ticks % 10)))" "$verb" "$(($(date +%s) - started))" "$description"
    ticks=$((ticks + 1))
  done

  status=0
  wait "$pid" || status=$?
  clear_progress

  if [ "$status" -ne 0 ]; then
    printf '   ✖ 失败，耗时 %s\n' "$(format_duration "$(($(date +%s) - started))")"
    printf '   日志 %s\n' "$log"
    tr '\r' '\n' <"$log" | tail -n 40 | sed 's/^/   /'
    exit "$status"
  fi

  print_key_lines "$log" "$pattern"
  printf '   ✔ %s\n' "$(format_duration "$(($(date +%s) - started))")"
}

# 渠道会决定服务注册路径；拒绝把其他并发构建的 CLI 装进桌面包。
verify_cli() {
  bun "$REPO/.fork/verify-cli.ts" "$1" "$CLI_VERSION"
}

case "$1" in
  desktop)
    printf '🚀 opencode 桌面端打包\n'
    printf '   CLI v%s · %s · channel latest → app prod\n' "$CLI_VERSION" "$HOST_ARCH"
    printf '   日志 %s\n' "$LOG_DIR"

    run_step '构建' '👻 构建 CLI' "^building cli-|$ERROR_PATTERN" \
      env OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build --single --skip-install

    CLI_DIST="$REPO/packages/cli/dist"
    CLI_BINARY="$CLI_DIST/cli-darwin-$HOST_ARCH/bin/opencode"

    run_step '校验' '🔍 校验 CLI 产物' "^\[verify\]|CLI 构建目录被并发修改|$ERROR_PATTERN" verify_cli "$CLI_BINARY"

    CLI_HASH=$(shasum -a 256 "$CLI_BINARY" | cut -d ' ' -f 1)

    # 桌面端 prod/beta 渠道的 prebuild 会把 OPENCODE_CLI_DIST 指向的 CLI 拷进
    # resources/opencode-cli（packages/desktop/scripts/prebuild.ts）。fork 自用必须
    # 用我们自己构建的 CLI，否则界面是新的、服务端还是上游的。
    run_step '构建' '💻 构建桌面端（electron-vite）' "^✓ built in|$ERROR_PATTERN" \
      env OPENCODE_CHANNEL=prod OPENCODE_CLI_DIST="$CLI_DIST" bun run --cwd packages/desktop build

    # 必须在 packages/desktop 下执行：electron-builder 可执行文件与 --config 都相对该目录解析。
    run_step '打包' '📦 打包 macOS 应用（electron-builder）' \
      "^• +(packaging|downloaded|building|skipped macOS|installing|completed)|$ERROR_PATTERN" \
      env \
      CSC_IDENTITY_AUTO_DISCOVERY=false \
      ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true \
      OPENCODE_CHANNEL=prod \
      OPENCODE_CLI_DIST="$CLI_DIST" \
      ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
      sh -c "cd '$REPO/packages/desktop' && npx electron-builder --mac --publish never --config electron-builder.config.ts"

    APP_DIRECTORY=mac
    if [ "$HOST_ARCH" = "arm64" ]; then APP_DIRECTORY=mac-arm64; fi
    PACKAGED_APP="$REPO/packages/desktop/dist/$APP_DIRECTORY/OpenCode.app"
    PACKAGED_CLI="$PACKAGED_APP/Contents/Resources/opencode-cli"
    # artifactName 是 opencode-desktop-${os}-${arch}.${ext}，交付物给 dmg 而不是 .app
    DMG_PATH="$REPO/packages/desktop/dist/opencode-desktop-mac-$HOST_ARCH.dmg"

    verify_package() {
      verify_cli "$PACKAGED_CLI"
      # 签名会改变二进制哈希，所以比较签名后的 resources 副本与 app 中的副本。
      cmp "$REPO/packages/desktop/resources/opencode-cli" "$PACKAGED_CLI"
      # 并发构建会改写 CLI 产物，交付前再确认哈希没变。
      test "$CLI_HASH" = "$(shasum -a 256 "$CLI_BINARY" | cut -d ' ' -f 1)" || {
        echo "CLI 构建目录被并发修改，本次产物不可交付" >&2
        exit 1
      }
      codesign --verify --deep --strict "$PACKAGED_APP"
      # 汇总里要给 dmg 路径，缺了说明打包没真正完成。
      test -f "$DMG_PATH" || {
        echo "缺少 dmg 产物：$DMG_PATH" >&2
        exit 1
      }
    }

    run_step '校验' '🔐 校验产物与签名' "^\[verify\]|CLI 构建目录被并发修改|缺少 dmg|$ERROR_PATTERN" verify_package

    printf '\n📦 %s\n' "$DMG_PATH"
    printf '📄 %s\n' "$LOG_DIR"
    printf '✨ Done in %s.\n' "$(format_duration "$(($(date +%s) - BUILD_STARTED))")"
    ;;
  *)
    printf '🚀 opencode CLI 打包\n'
    printf '   v%s · %s · channel latest\n' "$CLI_VERSION" "$HOST_ARCH"
    printf '   日志 %s\n' "$LOG_DIR"

    run_step '构建' '👻 构建 CLI' "^building cli-|$ERROR_PATTERN" \
      env OPENCODE_CHANNEL=latest OPENCODE_VERSION="$CLI_VERSION" bun run --cwd packages/cli build --single --skip-install

    printf '\n📦 %s\n' "$REPO/packages/cli/dist"
    printf '✨ Done in %s.\n' "$(format_duration "$(($(date +%s) - BUILD_STARTED))")"
    ;;
esac
