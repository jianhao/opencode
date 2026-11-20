import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import {
  renderHandoffPrompt,
  renderHandoffStartPrompt,
  renderHandoffTranscript,
} from "./handoff-brief"

const user = (text: string): SessionMessageInfo => ({
  id: `msg_user_${text}`,
  type: "user",
  text,
  time: { created: 1 },
})

const assistant = (
  content: Extract<SessionMessageInfo, { type: "assistant" }>["content"],
  files?: string[],
): SessionMessageInfo => ({
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { providerID: "provider", id: "model" },
  content,
  snapshot: files ? { files } : undefined,
  time: { created: 2, completed: 3 },
})

describe("handoff brief", () => {
  test("keeps the latest compact checkpoint and concrete tool files", () => {
    const transcript = renderHandoffTranscript([
      {
        id: "msg_compaction",
        type: "compaction",
        status: "completed",
        reason: "manual",
        summary: "Previous checkpoint objective",
        time: { created: 1 },
      },
      user("继续修复登录问题"),
      assistant(
        [
          {
            type: "tool",
            id: "tool_read",
            name: "read",
            state: {
              status: "completed",
              input: { path: "src/login.ts" },
              content: [{ type: "text", text: "export const login = true" }],
            },
            time: { created: 2, completed: 3 },
          },
        ],
        ["src/session.ts"],
      ),
    ])

    expect(transcript).toContain("Previous checkpoint objective")
    expect(transcript).toContain("src/login.ts")
    expect(transcript).toContain("src/session.ts")
    expect(transcript).toContain("export const login = true")
  })

  test("bounds large tool output while retaining its beginning and end", () => {
    const output = `${"a".repeat(2_000)}MIDDLE${"z".repeat(2_000)}`

    const transcript = renderHandoffTranscript([
      assistant([
        {
          type: "tool",
          id: "tool_shell",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "run tests" },
            content: [{ type: "text", text: output }],
          },
          time: { created: 2, completed: 3 },
        },
      ]),
    ])

    expect(transcript.length).toBeLessThanOrEqual(24_000)
    expect(transcript).toContain("a".repeat(500))
    expect(transcript).toContain("z".repeat(500))
  })

  test("asks the new session to understand the brief without doing work", () => {
    const start = renderHandoffStartPrompt("## 目标\n- 继续修复")

    expect(start).toContain("不要调用工具")
    expect(start).toContain("不要修改文件")
    expect(start).toContain("只回复“已知晓”")
    expect(start).toContain("## 目标\n- 继续修复")
    expect(renderHandoffPrompt("bounded transcript")).toContain("相关文件")
    expect(renderHandoffPrompt("bounded transcript")).toContain("不超过 900 个汉字")
    expect(renderHandoffPrompt("bounded transcript")).toContain("bounded transcript")
  })
})
