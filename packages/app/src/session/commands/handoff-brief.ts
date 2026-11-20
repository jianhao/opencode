import type { JsonValue, SessionMessageInfo } from "@opencode/client/promise"

const MESSAGE_MAX = 80

const MESSAGE_CLIP = 2_000

const TOOL_CLIP = 1_200

const TRANSCRIPT_MAX = 24_000

const FILE_MAX = 15

const INSTRUCTIONS = `你是交接助手。请根据下面的会话材料生成一份交接简报，让新会话无需重新阅读完整历史也能理解当前工作。

要求：
- 使用 Markdown，标题依次为：## 目标、## 关键要求、## 已做决定、## 工作状态、## 下一步、## 相关文件、## 重要上下文。
- “工作状态”下包含 ### 已完成、### 进行中、### 受阻。
- 重点是目标、用户明确要求、已完成/未完成、阻塞、下一步和真正需要打开的文件。
- “相关文件”最多 8 项，优先列出实际修改、读取、搜索命中的文件；每项写明路径和用途。
- 保留准确的路径、符号、命令、错误文本和标识符。
- 不执行任务、不调用工具、不虚构未发生的工作。
- 仅提炼继续工作所需的信息，不复述过程。
- 总计不超过 900 个汉字；每个小节最多 5 条，每条不超过 40 个汉字。
- 只返回 Markdown 简报。

会话材料：
`

export function renderHandoffTranscript(messages: readonly SessionMessageInfo[]) {
  const checkpoint = messages.findLast(
    (message) => message.type === "compaction" && message.status === "completed",
  )

  const files = new Set<string>()
  const lines: string[] = []

  if (checkpoint) lines.push(`[之前的 compact 简报]\n${clip(checkpoint.summary, TRANSCRIPT_MAX / 3)}`)

  for (const message of messages.slice(-MESSAGE_MAX)) {
    if (message.type === "user") {
      const text = message.text.trim()

      if (text) lines.push(`[用户]\n${clip(text, MESSAGE_CLIP)}`)
      continue
    }

    if (message.type !== "assistant") continue

    for (const file of message.snapshot?.files ?? []) files.add(file)

    for (const part of message.content) {
      if (part.type === "text" && part.text.trim()) {
        lines.push(`[助手]\n${clip(part.text.trim(), MESSAGE_CLIP)}`)
        continue
      }

      if (part.type !== "tool") continue

      if (part.state.status !== "streaming") collectPaths(part.state.input, files)
      const result = toolText(part)

      lines.push(
        [
          `[工具 ${part.name}]`,
          `输入: ${clip(JSON.stringify(part.state.input), TOOL_CLIP)}`,
          result ? `结果: ${clip(result, TOOL_CLIP)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
    }
  }

  if (files.size > 0) lines.push(`[工具涉及的文件]\n${[...files].slice(0, FILE_MAX).join("\n")}`)

  return clipTail(lines.join("\n\n"), TRANSCRIPT_MAX)
}

export function renderHandoffPrompt(transcript: string) {
  return `${INSTRUCTIONS}${transcript}`
}

export function renderHandoffStartPrompt(brief: string) {
  return `下面是上一个会话的交接简报。请先阅读并了解当前情况。

本轮不要调用工具，不要修改文件，不要继续执行任何任务，也不要提出下一步操作；只回复“已知晓”，等待我后续指令。

${brief.trim()}`
}

function collectPaths(input: Readonly<Record<string, JsonValue>>, files: Set<string>) {
  const serialized = JSON.stringify(input)

  const paths = serialized.matchAll(
    /"(?:path|filePath|file|directory|cwd|root)"\s*:\s*"((?:\\.|[^"\\])+)"/gi,
  )

  for (const match of paths) {
    const path = match[1]

    if (path) files.add(path)
  }
}

function toolText(part: Extract<SessionMessageInfo, { type: "assistant" }>["content"][number]) {
  if (part.type !== "tool" || !("content" in part.state) || !part.state.content) return ""

  const text: string[] = []

  for (const item of part.state.content) {
    if (item.type === "text") text.push(item.text)

    if (item.type === "file") text.push(item.uri)
  }

  return text.join("\n").trim()
}

function clip(value: string, max: number) {
  if (value.length <= max) return value

  const half = Math.floor((max - 5) / 2)

  return `${value.slice(0, half)}\n…\n${value.slice(-half)}`
}

function clipTail(value: string, max: number) {
  return value.length <= max ? value : value.slice(-max)
}
