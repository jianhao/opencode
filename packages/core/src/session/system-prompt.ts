export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"
import { SessionForkPrompts } from "./fork-prompts.js"

export function make(tools: string[]) {
  return withFork(render(PROMPT, tools))
}

// The fork language/style directive must sit at the top of the final system text so it
// also survives the model-family prompt the optimize plugin installs (gpt/claude/kimi/...):
// that plugin replaces the whole system text with render(familyTemplate, tools).
export function withFork(text: string) {
  return `${SessionForkPrompts.LANGUAGE}\n\n${SessionForkPrompts.STYLE}\n\n${text}`
}

export function render(prompt: string, tools: string[]) {
  const instructions: string[] = []
  if (tools.includes("shell")) {
    instructions.push(
      "- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.",
      "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.",
    )
  }
  if (tools.includes("write")) {
    instructions.push(
      "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
    )
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    )
  }
  return prompt.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
}
