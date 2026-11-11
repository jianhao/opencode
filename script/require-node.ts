// 在 lint / typecheck 之前先校验 Node 版本。
// 否则版本过低时，只会看到 packages/posts 里 astro 抛的一句 "Node.js v20.x is not supported by Astro!"，
// 要到 17 个 turbo 任务跑完才知道哪里错了。
import { execFileSync } from "node:child_process"

// 下限来自 packages/posts 的 Astro 工具链（astro 要求 >=22.12.0）
const MINIMUM = "22.12.0"

type Version = readonly [major: number, minor: number, patch: number] // 固定三段的版本号

const parsing = /^v?(\d+)\.(\d+)\.(\d+)/

function parse(version: string): Version | undefined {
  const matched = parsing.exec(version.trim())
  if (!matched) return undefined
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

function compare(a: Version, b: Version) {
  const [aMajor, aMinor, aPatch] = a
  const [bMajor, bMinor, bPatch] = b
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

// bun 的 process.versions.node 是它模拟的版本，这里必须取 PATH 上真正会被 astro 用到的那个 node
function currentNode() {
  try {
    return execFileSync("node", ["-v"], { encoding: "utf8" }).trim()
  } catch {
    return undefined
  }
}

const current = currentNode()
const required = parse(MINIMUM)
const found = current ? parse(current) : undefined

if (!current) {
  console.error(`\n[require-node] 找不到 node，请安装 Node >= v${MINIMUM} 后重试\n`)
  process.exit(1)
}

if (!found) {
  console.error(`\n[require-node] 无法解析 node 版本：${current}\n`)
  process.exit(1)
}

if (required && compare(found, required) < 0) {
  const major = required[0]
  console.error(
    [
      "",
      `[require-node] Node 版本过低：当前 ${current}，需要 >= v${MINIMUM}`,
      "",
      "  修复方式：",
      `    nvm use ${major}        # 已装 ${major}.x 时`,
      `    nvm install ${major}    # 没装过时`,
      "",
    ].join("\n"),
  )
  process.exit(1)
}
