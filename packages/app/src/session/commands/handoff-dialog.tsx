import { Component, Show, createSignal, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Textarea } from "@opencode/ui/textarea"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import "./handoff-dialog.css"

// Keep the handoff brief anchored on what the session is trying to do, not on a
// replay of every command. Newest messages win when the transcript is over budget.
const MESSAGE_MAX = 80
const TRANSCRIPT_MAX = 80_000

const INSTRUCTIONS = `You are writing a handoff brief so a fresh session can continue this work without re-reading the whole transcript.

Write Markdown with these sections, in this order:
## Objective
## Important Details
## Work State
### Completed
### Active
### Blocked
## Next Move
## Relevant Files

Be specific and concise; do not invent work that was not done.

请用简体中文撰写这份交接简报，并把小标题一并译成中文（Objective→目标，Important Details→重要信息，Work State→工作状态，Completed→已完成，Active→进行中，Blocked→受阻，Next Move→下一步，Relevant Files→相关文件），章节顺序保持不变。

Transcript:
`

export function renderHandoffTranscript(messages: readonly SessionMessageInfo[]) {
  const lines: string[] = []
  for (const message of messages.slice(-MESSAGE_MAX)) {
    if (message.type === "user") {
      const text = message.text.trim()
      if (text) lines.push(`[User]: ${text}`)
      continue
    }
    if (message.type !== "assistant") continue
    const chunks: string[] = []
    for (const part of message.content) {
      if (part.type === "text" && part.text.trim()) chunks.push(`[Assistant]: ${part.text.trim()}`)
      else if (part.type === "tool") chunks.push(`[Tool ${part.name}]`)
    }
    if (chunks.length) lines.push(chunks.join("\n"))
  }
  const text = lines.join("\n\n")
  return text.length > TRANSCRIPT_MAX ? text.slice(-TRANSCRIPT_MAX) : text
}

export const DialogHandoff: Component<{ sessionID: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const data = useData()
  const server = useServer()
  const serverSDK = useServerSDK()
  const [brief, setBrief] = createSignal("")
  const [generating, setGenerating] = createSignal(true)
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  const generate = async () => {
    setGenerating(true)
    setFailed(false)
    try {
      const transcript = renderHandoffTranscript(data.session.message.list(props.sessionID))
      const result = await serverSDK.api.session.generate({
        sessionID: props.sessionID,
        prompt: `${INSTRUCTIONS}${transcript}`,
      })
      setBrief((result as { text?: string }).text ?? "")
    } catch {
      setFailed(true)
    } finally {
      setGenerating(false)
    }
  }

  onMount(() => void generate())

  const start = async () => {
    const text = brief().trim()
    if (!text || busy()) return
    setBusy(true)
    try {
      const info = data.session.get(props.sessionID)
      const created = await serverSDK.api.session.create({
        title: info ? `↪ ${info.title}` : undefined,
        agent: info?.agent,
        model: info?.model,
        location: info ? { directory: info.location.directory } : undefined,
        metadata: { handoffFrom: { id: props.sessionID, title: info?.title ?? "" } },
      })
      await serverSDK.api.session.prompt({ sessionID: created.id, text })
      dialog.close()
      navigate(sessionHref(server.key, created.id))
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      setBusy(false)
    }
  }

  const canStart = () => !busy() && !generating() && !failed()

  return (
    <Dialog containerClass="handoff-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("dialog.handoff.title")}
          description={language.t("dialog.handoff.description")}
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col px-4 py-3">
        <Show
          when={!generating()}
          fallback={
            <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-muted">
              {language.t("dialog.handoff.generating")}
            </div>
          }
        >
          <Show
            when={!failed()}
            fallback={
              <div class="flex flex-1 flex-col items-center justify-center gap-3">
                <div class="text-[13px] text-v2-state-fg-danger">{language.t("dialog.handoff.failed")}</div>
                <Button type="button" variant="neutral" onClick={() => void generate()}>
                  {language.t("dialog.handoff.retry")}
                </Button>
              </div>
            }
          >
            <Textarea
              value={brief()}
              spellcheck={false}
              onInput={(event) => setBrief(event.currentTarget.value)}
            />
          </Show>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" disabled={!canStart()} onClick={() => void start()}>
          {busy() ? language.t("dialog.handoff.starting") : language.t("dialog.handoff.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
