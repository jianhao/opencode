// 生成图标盘点 HTML：目录里有哪些图标、各自语义色、在哪些代码位置用到。
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { getIcon, iconNames } from "../../packages/ui/src/icons/catalog.ts"
import { iconTone } from "../../packages/ui/src/icons/icon/tones.ts"

const root = "/Users/user/Desktop/work/pier/tools/opencode/packages"
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue
    if (/\.(test|stories)\./.test(entry)) continue
    files.push(full)
  }
}

for (const dir of ["app/src", "ui/src", "session-ui/src", "gui-plugins/src", "desktop/src"]) walk(join(root, dir))

const patterns = [/<Icon\s+[^>]*?\bname="([a-z0-9-]+)"/g, /\bicon:\s*"([a-z0-9-]+)"/g, /\bicon="([a-z0-9-]+)"/g]
const usage = new Map()

for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const re of patterns) {
        re.lastIndex = 0
        let match
        while ((match = re.exec(line))) {
          const name = match[1]
          if (!usage.has(name)) usage.set(name, [])
          usage.get(name).push({ file: relative(root, file), line: index + 1, code: line.trim().slice(0, 120) })
        }
      }
    })
}

const toneColor = {
  accent: "#8839ef",
  info: "#5e07b1",
  success: "#1d7303",
  warning: "#9e6207",
  neutral: "#8b8da1",
}

const rows = iconNames()
  .map((name) => {
    const locations = usage.get(name) ?? []
    const icon = getIcon(name)
    return { name, tone: iconTone(name), locations, viewBox: icon.viewBox, body: icon.body }
  })
  .sort((a, b) => b.locations.length - a.locations.length || a.name.localeCompare(b.name))

const esc = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const cards = rows
  .map((row) => {
    const color = toneColor[row.tone]
    const locations = row.locations
      .slice(0, 8)
      .map((l) => `<li><code>${esc(l.file)}:${l.line}</code><span>${esc(l.code)}</span></li>`)
      .join("")
    return `<article class="card" data-tone="${row.tone}" data-used="${row.locations.length ? "yes" : "no"}">
  <header>
    <svg viewBox="${row.viewBox}" style="color:${color}">${row.body}</svg>
    <div>
      <h3>${row.name}</h3>
      <p><span class="tone">${row.tone}</span> · ${row.locations.length} 处</p>
    </div>
  </header>
  ${locations ? `<ul>${locations}</ul>` : `<p class="unused">目录里有，但当前代码没用到</p>`}
</article>`
  })
  .join("\n")

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>OpenCode 图标盘点</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 32px 60px; font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; color: #1f2330; background: #f7f7f9; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .lead { margin: 0 0 18px; color: #6c6f83; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .filters button { border: 1px solid #d9d9e3; border-radius: 8px; padding: 4px 10px; background: #fff; cursor: pointer; font: inherit; }
  .filters button[aria-pressed="true"] { border-color: #8839ef; color: #8839ef; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .card { border: 1px solid #e3e3ea; border-radius: 12px; padding: 12px 14px; background: #fff; }
  .card header { display: flex; align-items: center; gap: 10px; }
  .card svg { width: 26px; height: 26px; flex: 0 0 auto; }
  .card svg * { stroke-width: 1.4; }
  .card h3 { margin: 0; font-size: 13px; font-family: ui-monospace, monospace; }
  .card p { margin: 0; color: #6c6f83; font-size: 11.5px; }
  .tone { color: #1f2330; font-weight: 600; }
  .card ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
  .card li { display: flex; gap: 8px; align-items: baseline; font-size: 11px; color: #6c6f83; overflow: hidden; }
  .card li code { flex: 0 0 auto; color: #8839ef; font-size: 10.5px; }
  .card li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unused { margin-top: 8px !important; color: #a5a7b7 !important; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>OpenCode 图标盘点</h1>
<p class="lead">共 ${rows.length} 个图标，其中 ${rows.filter((r) => r.locations.length).length} 个在用。语义色来自 <code>packages/ui/src/icons/icon/tones.ts</code>，图形来自 <code>packages/ui/src/icons/catalog.ts</code>。换新图标时按本表逐个替换。</p>
<div class="filters">
  <button data-filter="all" aria-pressed="true">全部 ${rows.length}</button>
  <button data-filter="used" aria-pressed="false">在用 ${rows.filter((r) => r.locations.length).length}</button>
  <button data-filter="accent" aria-pressed="false">accent</button>
  <button data-filter="info" aria-pressed="false">info</button>
  <button data-filter="success" aria-pressed="false">success</button>
  <button data-filter="warning" aria-pressed="false">warning</button>
  <button data-filter="neutral" aria-pressed="false">neutral</button>
</div>
<div class="grid">
${cards}
</div>
<script>
  const cards = [...document.querySelectorAll(".card")]
  const buttons = [...document.querySelectorAll(".filters button")]
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)))
      const filter = button.dataset.filter
      cards.forEach((card) => {
        const show =
          filter === "all" ||
          (filter === "used" && card.dataset.used === "yes") ||
          (filter !== "used" && card.dataset.tone === filter)
        card.classList.toggle("hidden", !show)
      })
    })
  )
</script>
</body>
</html>
`

const out = "/Users/user/Desktop/work/pier/tools/opencode/docs/图标盘点.html"
writeFileSync(out, html)
console.log(out, rows.length, "icons", rows.filter((r) => r.locations.length).length, "used")
