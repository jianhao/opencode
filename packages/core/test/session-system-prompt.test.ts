import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"

test("renders the default system prompt instructions", () => {
  const prompt = SessionSystemPrompt.make(["edit", "read", "shell"])
  expect(prompt).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  expect(prompt).toContain("Use the edit tool for targeted changes to existing text files")
})

test("scopes corrections to changed work instead of the previous answer template", () => {
  const prompt = SessionSystemPrompt.make([])
  expect(prompt).toContain("Treat earlier assistant answers as context, not as an outline to continue")
  expect(prompt).toContain("treat only that correction as the task")
  expect(prompt).toContain("Do not repeat unchanged sections")
  expect(prompt).not.toContain("Start each section with a fitting emoji")
})

test("describes each tool batch and summarizes the result", () => {
  const prompt = SessionSystemPrompt.make([])
  expect(prompt).toContain("Before each batch of tool calls, write one concise sentence")
  expect(prompt).toContain("Do not dump raw shell commands or tool output")
  expect(prompt).toContain("After the tools finish, synthesize the findings into a clear conclusion")
  expect(prompt).not.toContain("Call tools silently; write nothing until the final answer")
})
