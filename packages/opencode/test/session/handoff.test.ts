import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { renderHandoffTranscript } from "../../src/session/handoff"

const user = (text: string, options: { synthetic?: boolean; ignored?: boolean } = {}) =>
  ({ info: { role: "user" }, parts: [{ type: "text", text, ...options }] }) as unknown as SessionV1.WithParts

const assistant = (parts: unknown[]) =>
  ({ info: { role: "assistant" }, parts }) as unknown as SessionV1.WithParts

const completed = (tool: string, output: string) => ({ type: "tool", tool, state: { status: "completed", output } })
const failed = (tool: string, error: string) => ({ type: "tool", tool, state: { status: "error", error } })

describe("session.handoff renderHandoffTranscript", () => {
  test("keeps user intent and tool names, drops synthetic user text", () => {
    const transcript = renderHandoffTranscript([
      user("do the thing"),
      user("system reminder", { synthetic: true }),
      user("ignored memo", { ignored: true }),
      assistant([{ type: "text", text: "working on it" }, completed("bash", "x".repeat(500)), failed("read", "boom")]),
    ])

    expect(transcript).toContain("[User]: do the thing")
    expect(transcript).not.toContain("system reminder")
    expect(transcript).not.toContain("ignored memo")
    expect(transcript).toContain("[Assistant]: working on it")
    expect(transcript).toContain("[Tool bash]: ")
    expect(transcript).toContain("…")
    expect(transcript).not.toContain("x".repeat(500))
    expect(transcript).toContain("[Tool read error]: boom")
  })

  test("keeps only the most recent messages", () => {
    const transcript = renderHandoffTranscript(Array.from({ length: 100 }, (_, i) => user(`m${i}`)))
    expect(transcript).toContain("[User]: m99")
    expect(transcript).toContain("[User]: m20")
    expect(transcript).not.toContain("[User]: m19")
    expect(transcript).not.toContain("[User]: m0")
  })

  test("returns an empty string when there is nothing to hand off", () => {
    expect(renderHandoffTranscript([])).toBe("")
    expect(renderHandoffTranscript([user("   ", { synthetic: true })])).toBe("")
  })
})
