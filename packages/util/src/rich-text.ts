/**
 * 云效工作项正文/评论是富文本：接口可能给 htmlValue（HTML），也可能给 jsonMLValue（JSONML 数组），
 * 甚至是一层字符串里再套 JSON。这里沿用 yunxiao-web `utils/yunxiaoRichText.ts` 的解析方式，
 * 统一产出可渲染 HTML 与纯文本：主进程解析，渲染进程负责最终净化与展示。
 */

export interface ParsedRichText {
  html: string
  text: string
}

interface JsonMlNode {
  tag: string
  attrs: Record<string, unknown>
  children: unknown[]
}

const ALLOWED_TAGS = new Set([
  "p",
  "div",
  "span",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "colgroup",
  "col",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "br",
  "hr",
  "img",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
])

const SELF_CLOSING_TAGS = new Set(["br", "hr", "img", "col"])
const TAG_ALIAS_MAP: Record<string, string> = {
  tc: "td",
}

export function parseRichText(value: unknown): ParsedRichText {
  const raw = normalizeRawRichTextValue(value)
  if (!raw) {
    return { html: "", text: "" }
  }

  const payload = extractRichPayload(value)
  const jsonMlHtml = renderJsonMl(payload.jsonMl)
  const preferredHtml = shouldPreferHtmlValue(payload.html) ? payload.html : ""
  const mergedHtml = mergeRichHtml(payload.html, jsonMlHtml)
  const rawHtml =
    preferredHtml || mergedHtml || payload.html || jsonMlHtml || (looksLikeHtml(raw) ? sanitizeHtml(raw) : "") || ""
  const html = normalizeRichHtmlOutput(rawHtml || raw)
  return {
    html,
    text: normalizeDocText(stripHtmlTags(html)),
  }
}

function extractRichPayload(value: unknown): { html: string; jsonMl: unknown } {
  if (isPlainRecord(value) || Array.isArray(value)) {
    const htmlValue = normalizeHtmlValue(findFirstField(value, ["htmlValue", "htmlValueString"]))
    const jsonMlValue = findFirstField(value, ["jsonMLValue", "jsonMlValue"])
    if (htmlValue || jsonMlValue) {
      return { html: htmlValue, jsonMl: jsonMlValue }
    }

    const nestedValue = findFirstField(value, [
      "content",
      "comment",
      "body",
      "richText",
      "value",
      "text",
      "description",
    ])
    if (nestedValue && nestedValue !== value) {
      const nestedPayload = extractRichPayload(nestedValue)
      if (hasRichPayload(nestedPayload)) {
        return nestedPayload
      }
    }

    return { html: "", jsonMl: null }
  }

  const raw = decodeHtmlEntities(normalizeRawRichTextValue(value))
  if (!raw) {
    return { html: "", jsonMl: null }
  }

  const parsed = tryParseJson(raw)
  if (parsed !== null) {
    const parsedPayload = extractRichPayload(parsed)
    if (hasRichPayload(parsedPayload)) {
      return parsedPayload
    }
  }

  const decodedRaw = decodeEscapedString(raw)
  if (decodedRaw && decodedRaw !== raw) {
    const decodedPayload = extractRichPayload(decodedRaw)
    if (hasRichPayload(decodedPayload)) {
      return decodedPayload
    }
  }

  const htmlMatch = raw.match(/"htmlValue"\s*:\s*"((?:\\.|[^"\\])*)"/i)
  const matchedHtml = htmlMatch?.[1] ? normalizeHtmlValue(decodeEscapedString(htmlMatch[1])) : ""
  if (htmlMatch?.[1]) {
    const rawJsonMl = extractJsonMlValueFromRaw(raw)
    if (matchedHtml || rawJsonMl) {
      return {
        html: matchedHtml,
        jsonMl: rawJsonMl,
      }
    }
  }

  const rawJsonMl = extractJsonMlValueFromRaw(raw)
  if (rawJsonMl) {
    return {
      html: matchedHtml,
      jsonMl: rawJsonMl,
    }
  }

  return { html: "", jsonMl: null }
}

function hasRichPayload(payload: { html: string; jsonMl: unknown }): boolean {
  return Boolean(payload.html || payload.jsonMl)
}

function normalizeRawRichTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim()
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value).trim()
    } catch {
      return ""
    }
  }

  return ""
}

function renderJsonMl(value: unknown): string {
  if (!value) {
    return ""
  }

  if (typeof value === "string") {
    return escapeHtml(value)
  }

  if (!Array.isArray(value)) {
    return ""
  }

  const node = normalizeJsonMlNode(value)
  if (!node) {
    return value.map((item) => renderJsonMl(item)).join("")
  }

  if (node.tag === "root") {
    return renderJsonMlRoot(node.children)
  }

  if (!ALLOWED_TAGS.has(node.tag)) {
    return node.children.map((item) => renderJsonMl(item)).join("")
  }

  const attrs = renderHtmlAttributes(node.tag, node.attrs)
  if (SELF_CLOSING_TAGS.has(node.tag)) {
    return `<${node.tag}${attrs}>`
  }

  const children = node.children.map((item) => renderJsonMl(item)).join("")
  return `<${node.tag}${attrs}>${children}</${node.tag}>`
}

function renderJsonMlRoot(children: unknown[]): string {
  const rendered: string[] = []
  let listBuffer: { type: "ul" | "ol"; level: number; symbol: string; items: string[] } | null = null

  const flushListBuffer = () => {
    if (!listBuffer) {
      return
    }
    const symbolAttr = listBuffer.symbol ? ` data-list-symbol="${escapeAttribute(listBuffer.symbol)}"` : ""
    rendered.push(`<${listBuffer.type}${symbolAttr}>${listBuffer.items.join("")}</${listBuffer.type}>`)
    listBuffer = null
  }

  children.forEach((child) => {
    const node = Array.isArray(child) ? normalizeJsonMlNode(child) : null
    const listMeta = node ? readJsonMlListMeta(node) : null
    if (!node || !listMeta) {
      flushListBuffer()
      rendered.push(renderJsonMl(child))
      return
    }

    const currentType = listMeta.isOrdered ? "ol" : "ul"
    const itemHtml = renderJsonMlListItem(node)
    if (!itemHtml) {
      flushListBuffer()
      rendered.push(renderJsonMl(child))
      return
    }

    if (
      !listBuffer ||
      listBuffer.type !== currentType ||
      listBuffer.level !== listMeta.level ||
      listBuffer.symbol !== listMeta.symbol
    ) {
      flushListBuffer()
      listBuffer = { type: currentType, level: listMeta.level, symbol: listMeta.symbol, items: [] }
    }
    listBuffer.items.push(renderJsonMlListItem(node, listMeta.symbol))
  })

  flushListBuffer()
  return rendered.join("")
}

function renderJsonMlListItem(node: JsonMlNode, symbol = ""): string {
  const content = node.children
    .map((item) => renderJsonMl(item))
    .join("")
    .trim()
  if (!content) {
    return ""
  }
  const symbolAttr = symbol ? ` data-list-symbol="${escapeAttribute(symbol)}"` : ""
  return `<li${symbolAttr}>${content}</li>`
}

function readJsonMlListMeta(node: JsonMlNode): { isOrdered: boolean; level: number; symbol: string } | null {
  const list = isPlainRecord(node.attrs.list) ? (node.attrs.list as Record<string, unknown>) : null
  if (!list) {
    return null
  }

  const isOrdered = Boolean(list.isOrdered)
  const level = typeof list.level === "number" ? list.level : Number.parseInt(String(list.level ?? "0"), 10) || 0
  const symbol = isOrdered
    ? ""
    : readString((isPlainRecord(list.listStyle) ? (list.listStyle as Record<string, unknown>).text : "") || "")

  return { isOrdered, level, symbol }
}

function normalizeJsonMlNode(value: unknown[]): JsonMlNode | null {
  const [tagCandidate, second, ...rest] = value
  if (typeof tagCandidate !== "string") {
    return null
  }

  const normalizedTag = (TAG_ALIAS_MAP[tagCandidate.trim().toLowerCase()] || tagCandidate.trim().toLowerCase()).trim()
  if (!normalizedTag) {
    return null
  }

  if (isPlainRecord(second)) {
    return {
      tag: normalizedTag,
      attrs: second,
      children: rest,
    }
  }

  return {
    tag: normalizedTag,
    attrs: {},
    children: value.slice(1),
  }
}

function shouldPreferHtmlValue(value: string): boolean {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return false
  }

  return /<(table|colgroup|tbody|thead|tfoot|tr|td|th)\b/i.test(normalized)
}

function mergeRichHtml(htmlValue: string, jsonMlHtml: string): string {
  const normalizedHtml = String(htmlValue || "").trim()
  const normalizedJsonMlHtml = String(jsonMlHtml || "").trim()

  if (!normalizedHtml) {
    return normalizedJsonMlHtml
  }

  if (!normalizedJsonMlHtml) {
    return normalizedHtml
  }

  const htmlHasImage = /<img\b/i.test(normalizedHtml)
  const jsonMlHasImage = /<img\b/i.test(normalizedJsonMlHtml)
  if (!htmlHasImage && jsonMlHasImage) {
    return normalizedJsonMlHtml
  }

  const htmlStructureScore = getRichStructureScore(normalizedHtml)
  const jsonMlStructureScore = getRichStructureScore(normalizedJsonMlHtml)
  if (jsonMlStructureScore > htmlStructureScore) {
    return normalizedJsonMlHtml
  }

  return normalizedHtml
}

function getRichStructureScore(value: string): number {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return 0
  }

  let score = 0
  if (/<table\b/i.test(normalized)) score += 100
  if (/<(ul|ol)\b/i.test(normalized)) score += 60
  if (/<li\b/i.test(normalized)) score += 40
  if (/<hr\b/i.test(normalized)) score += 30
  if (/<blockquote\b/i.test(normalized)) score += 20
  if (/<pre\b/i.test(normalized)) score += 20
  if (/<h[1-6]\b/i.test(normalized)) score += 20
  if (/<br\b/i.test(normalized)) score += 10
  if (/<img\b/i.test(normalized)) score += 10
  return score
}

function renderHtmlAttributes(tag: string, attrs: Record<string, unknown>): string {
  const normalizedAttrs: Record<string, string> = {}

  if (tag === "a") {
    const href = sanitizeUrl(readString(attrs.href) || readString(attrs.url) || readString(attrs.src))
    if (href) {
      normalizedAttrs.href = href
      normalizedAttrs.target = "_blank"
      normalizedAttrs.rel = "noopener noreferrer"
    }
  }

  if (tag === "img") {
    const src = sanitizeUrl(readString(attrs.src) || readString(attrs.url))
    if (!src) {
      return ""
    }

    normalizedAttrs.src = src
    normalizedAttrs.alt = readString(attrs.alt) || readString(attrs.name) || "附件图片"
  }

  if (["td", "th"].includes(tag)) {
    const colSpan = readPositiveInteger(attrs.colspan ?? attrs.colSpan)
    const rowSpan = readPositiveInteger(attrs.rowspan ?? attrs.rowSpan)

    if (colSpan) {
      normalizedAttrs.colspan = String(colSpan)
    }

    if (rowSpan) {
      normalizedAttrs.rowspan = String(rowSpan)
    }
  }

  const style = renderInlineStyle(attrs)
  if (style) {
    normalizedAttrs.style = style
  }

  return Object.entries(normalizedAttrs)
    .map(([key, currentValue]) => ` ${key}="${escapeAttribute(currentValue)}"`)
    .join("")
}

function renderInlineStyle(attrs: Record<string, unknown>): string {
  const styles: string[] = []
  const textAlign = readString(attrs.textAlign)
  const color = normalizeColor(readString(attrs.color))
  const width = normalizeSize(readString(attrs.width))
  const minWidth = normalizeSize(readString(attrs.minWidth))

  if (textAlign && ["left", "center", "right"].includes(textAlign)) {
    styles.push(`text-align:${textAlign}`)
  }

  if (color) {
    styles.push(`color:${color}`)
  }

  if (width) {
    styles.push(`width:${width}`)
  }

  if (minWidth) {
    styles.push(`min-width:${minWidth}`)
  }

  return styles.join(";")
}

function normalizeHtmlValue(value: unknown): string {
  const decoded = decodeEscapedString(String(value || ""))
  return sanitizeHtml(decoded)
}

function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function sanitizeHtml(value: string): string {
  return String(value || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\sjavascript:/gi, " ")
    .trim()
}

// 块级标签清单：只有出现这些标签才当作真正的富文本，否则统一按纯文本重排段落。
const BLOCK_TAGS = /<(?:p|div|br|ul|ol|li|h[1-6]|table|tbody|thead|tfoot|tr|td|th|blockquote|pre|img|hr|figure)\b/i

function normalizeRichHtmlOutput(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return ""
  }

  // 有的正文外层是 <html>/<body>、里面没有任何块级标签，净化后会被压成挤在一起的一行。
  if (!looksLikeHtml(normalized) || !BLOCK_TAGS.test(normalized)) {
    return renderPlainText(stripHtmlTags(normalized))
  }

  return normalized
}

function renderPlainText(value: string): string {
  const normalized = normalizeDocText(value)
  if (!normalized) {
    return ""
  }

  return renderMarkdownBlocks(normalized)
}

// 云效正文/评论很多人直接写 Markdown：标题、围栏代码、列表、行内代码和链接都认得。
function renderMarkdownBlocks(value: string): string {
  const lines = String(value || "").split("\n")
  const rendered: string[] = []
  let paragraphLines: string[] = []
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null
  let fence: { lang: string; lines: string[] } | null = null

  const flushParagraph = () => {
    const text = paragraphLines.join("\n").trim()
    if (text) {
      rendered.push(`<p>${renderInline(text).replace(/\n/g, "<br>")}</p>`)
    }
    paragraphLines = []
  }

  const flushList = () => {
    if (!listBuffer) {
      return
    }
    rendered.push(`<${listBuffer.type}>${listBuffer.items.join("")}</${listBuffer.type}>`)
    listBuffer = null
  }

  const flush = () => {
    flushList()
    flushParagraph()
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    const fenceMatch = line.match(/^```\s*([\w-]*)\s*$/)

    if (fence) {
      if (fenceMatch) {
        rendered.push(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`)
        fence = null
      } else {
        fence.lines.push(rawLine)
      }
      continue
    }

    if (fenceMatch) {
      flush()
      fence = { lang: fenceMatch[1] ?? "", lines: [] }
      continue
    }

    if (!line) {
      flush()
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flush()
      const level = Math.min(headingMatch[1].length + 3, 6)
      rendered.push(`<h${level}>${renderInline(headingMatch[2] ?? "")}</h${level}>`)
      continue
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/)
    const nextType = unorderedMatch ? "ul" : orderedMatch ? "ol" : ""

    if (!nextType) {
      flushList()
      paragraphLines.push(line)
      continue
    }

    flushParagraph()
    if (!listBuffer || listBuffer.type !== nextType) {
      flushList()
      listBuffer = { type: nextType, items: [] }
    }
    const content = unorderedMatch?.[1] || orderedMatch?.[1] || ""
    listBuffer.items.push(`<li>${renderInline(content)}</li>`)
  }

  if (fence) {
    rendered.push(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`)
  }

  flush()

  return rendered.join("")
}

// 行内 Markdown：先转义，再补链接、粗体和行内代码，避免把用户输入当 HTML 执行。
function renderInline(value: string): string {
  return escapeHtml(String(value || ""))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(String(value || ""))
}

function stripHtmlTags(value: string): string {
  return String(value || "")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
}

function normalizeDocText(value: string): string {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function findFirstField(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") {
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstField(item, keys)
      if (nested) {
        return nested
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (record[key]) {
      return record[key]
    }
  }

  for (const currentValue of Object.values(record)) {
    const nested = findFirstField(currentValue, keys)
    if (nested) {
      return nested
    }
  }

  return null
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function extractJsonMlValueFromRaw(raw: string): unknown {
  const markerIndex = raw.search(/"jsonMLValue"|"jsonMlValue"/i)
  if (markerIndex < 0) {
    return null
  }

  const arrayStart = raw.indexOf("[", markerIndex)
  if (arrayStart < 0) {
    return null
  }

  const arrayText = extractBalancedJsonArray(raw, arrayStart)
  if (!arrayText) {
    return null
  }

  return tryParseJson(arrayText)
}

function extractBalancedJsonArray(source: string, startIndex: number): string {
  let depth = 0
  let inString = false
  let escaping = false

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]

    if (escaping) {
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === "[") {
      depth += 1
      continue
    }

    if (char === "]") {
      depth -= 1
      if (depth === 0) {
        return source.slice(startIndex, index + 1)
      }
    }
  }

  return ""
}

function decodeEscapedString(value: string): string {
  try {
    return JSON.parse(`"${String(value).replace(/"/g, '\\"')}"`) as string
  } catch {
    return String(value || "")
  }
}

function sanitizeUrl(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return ""
  }

  if (/^(https?:)?\/\//i.test(normalized) || normalized.startsWith("data:image/")) {
    return normalized
  }

  return ""
}

function normalizeColor(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return ""
  }

  if (/^#[0-9a-fA-F]{3,8}$/.test(normalized) || /^rgb(a)?\(/i.test(normalized)) {
    return normalized
  }

  return ""
}

function normalizeSize(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return ""
  }

  if (/^\d+(\.\d+)?(px|%|rem|em|vw|vh)?$/i.test(normalized)) {
    return /\D$/.test(normalized) ? normalized : `${normalized}px`
  }

  return ""
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readPositiveInteger(value: unknown): number | null {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null
  }

  return Math.floor(normalized)
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;")
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
