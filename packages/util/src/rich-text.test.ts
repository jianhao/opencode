import { describe, expect, test } from "bun:test"
import { parseRichText } from "./rich-text.js"

describe("Yunxiao rich text", () => {
  // 云效正文在 context 里常常是一层 JSON 字符串，直接展示会露出 {"htmlValue":...
  test("unwraps a JSON string and keeps the HTML", () => {
    const parsed = parseRichText(
      JSON.stringify({
        htmlValue: '<article><p style="text-align:left">跳的越权限 &amp; 控制</p></article>',
        jsonMLValue: ["root", ["p", {}, "跳的越权限 & 控制"]],
      }),
    )

    expect(parsed.html).toContain("<article>")
    expect(parsed.html).toContain("跳的越权限 & 控制")
    expect(parsed.text).toBe("跳的越权限 & 控制")
    expect(parsed.text).not.toContain("htmlValue")
  })

  test("renders JSONML lists when only the tree is present", () => {
    const parsed = parseRichText({
      jsonMLValue: ["root", ["p", {}, "说明"], ["ul", {}, ["li", {}, "第一项"], ["li", {}, "第二项"]]],
    })

    expect(parsed.html).toBe("<p>说明</p><ul><li>第一项</li><li>第二项</li></ul>")
    expect(parsed.text).toContain("第一项")
  })

  test("turns plain text and markdown-like lists into paragraphs", () => {
    expect(parseRichText("第一行\n第二行\n\n- 甲\n- 乙").html).toBe(
      "<p>第一行<br>第二行</p><ul><li>甲</li><li>乙</li></ul>",
    )
  })

  test("drops inline scripts", () => {
    expect(parseRichText("<p>正文</p><script>alert(1)</script>").html).toBe("<p>正文</p>")
  })

  // 有的正文外层是 <html>/<body>、内部没有块级标签，净化后会压成一行。
  test("re-paragraphs HTML that carries no block tags", () => {
    const html = parseRichText("<html><body>第一段\n第二段</body></html>").html

    expect(html).toBe("<p>第一段<br>第二段</p>")
  })

  // 云效里很多人直接写 Markdown，标题、围栏代码、行内代码和链接都要认。
  test("renders markdown headings, fences and inline marks in plain text", () => {
    const html = parseRichText(
      [
        "## 问题类型",
        "跨站请求与跨域边界。",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "- 第一条",
        "",
        "见 [清单](https://example.com/x) 与 `code`。",
      ].join("\n"),
    ).html

    expect(html).toContain("<h5>问题类型</h5>")
    expect(html).toContain("<pre><code>const a = 1;</code></pre>")
    expect(html).toContain("<ul><li>第一条</li></ul>")
    expect(html).toContain('<a href="https://example.com/x" target="_blank" rel="noreferrer">清单</a>')
    expect(html).toContain("<code>code</code>")
  })

  // 只把 http(s) 链接转成 <a>，其他协议原样留在文本里。
  test("only linkifies http(s) urls", () => {
    const html = parseRichText("见 [点我](javascript:alert(1)) 与 [官网](https://example.com)").html

    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">官网</a>')
  })
})
