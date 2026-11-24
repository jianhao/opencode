import DOMPurify from "dompurify"

/**
 * 云效正文/评论来自外部接口，渲染前必须净化：只保留普通 HTML，去掉脚本、表单控件和多余样式。
 * 云效会用 style 表达对齐，这里只保留 text-align，其余样式丢弃。
 */
const purifier = typeof window === "undefined" ? DOMPurify : DOMPurify(window)

purifier.setConfig({
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "object", "embed"],
  FORBID_CONTENTS: ["style", "script"],
})

purifier.addHook("beforeSanitizeAttributes", (node) => {
  // DOMPurify 也会把文档/文本节点送进 hook，非元素节点直接跳过。
  if (!(node instanceof Element)) return

  const style = node.getAttribute("style")

  if (!style) return

  const align = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i)?.[1]

  if (align) node.setAttribute("style", `text-align:${align.toLowerCase()}`)
  else node.removeAttribute("style")
})

purifier.addHook("afterSanitizeAttributes", (node) => {
  if (!(node instanceof HTMLAnchorElement)) return

  node.setAttribute("target", "_blank")
  node.setAttribute("rel", "noopener noreferrer")
})

export function safeRichText(html?: string) {
  if (!html) return ""

  return purifier.sanitize(html)
}
