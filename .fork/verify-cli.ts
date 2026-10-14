import { execFileSync } from "node:child_process"
import { basename, dirname, join } from "node:path"

const [binary, version] = process.argv.slice(2)
if (!binary || !version) throw new Error("需要 CLI 路径和预期版本")

// 编译时写入的启动参数同时携带渠道和版本，不启动后台服务即可核验。
const bytes = Buffer.from(await Bun.file(binary).arrayBuffer())
if (!bytes.includes(Buffer.from(`--user-agent=opencode/latest/${version}/cli`)))
  throw new Error(`CLI 渠道或版本不匹配，拒绝打包：${binary}`)

const actual = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim()
if (actual !== `opencode v${version}`) throw new Error(`CLI 版本不匹配：${actual}`)
if (basename(binary) === "opencode-cli") {
  const shipped = (await Bun.file(join(dirname(binary), "opencode-cli.version")).text()).trim()
  if (shipped !== version) throw new Error(`CLI 版本文件不匹配：${shipped}`)
}
console.log(`[verify] CLI latest/${version} 校验通过`)
