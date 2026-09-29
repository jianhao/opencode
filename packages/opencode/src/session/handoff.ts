import { SessionV1 } from "@opencode-ai/core/v1/session"

// Keep the handoff brief anchored on what the session is trying to do, not on a
// replay of every command. Newest messages win when the transcript is over budget.
const HANDOFF_MESSAGE_MAX = 80
const HANDOFF_TRANSCRIPT_MAX = 80_000
const HANDOFF_TOOL_OUTPUT_MAX = 400

function truncate(value: string) {
  return value.length <= HANDOFF_TOOL_OUTPUT_MAX ? value : `${value.slice(0, HANDOFF_TOOL_OUTPUT_MAX)}…`
}

export function renderHandoffTranscript(messages: SessionV1.WithParts[]) {
  const lines: string[] = []
  for (const message of messages.slice(-HANDOFF_MESSAGE_MAX)) {
    if (message.info.role === "user") {
      const text = message.parts
        .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
        .join("\n")
        .trim()
      if (text) lines.push(`[User]: ${text}`)
      continue
    }
    if (message.info.role !== "assistant") continue
    const chunks: string[] = []
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) chunks.push(`[Assistant]: ${part.text.trim()}`)
      else if (part.type === "tool") {
        if (part.state.status === "completed") chunks.push(`[Tool ${part.tool}]: ${truncate(part.state.output)}`)
        else if (part.state.status === "error") chunks.push(`[Tool ${part.tool} error]: ${part.state.error}`)
      }
    }
    if (chunks.length) lines.push(chunks.join("\n"))
  }
  const text = lines.join("\n\n")
  return text.length > HANDOFF_TRANSCRIPT_MAX ? text.slice(-HANDOFF_TRANSCRIPT_MAX) : text
}

export * as SessionHandoff from "./handoff"
