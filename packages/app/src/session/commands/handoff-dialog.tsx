import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Spinner } from "@opencode/ui/spinner"
import { Textarea } from "@opencode/ui/textarea"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useLayout } from "@/shell/state/layout"
import { errorMessage } from "@/shell/layout/helpers"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { renderHandoffPrompt, renderHandoffStartPrompt, renderHandoffTranscript } from "./handoff-brief"
import "./handoff-dialog.css"

type HandoffLog = {
  readonly id: number
  readonly emoji: string
  readonly label: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly status: "running" | "done" | "failed"
}

export const DialogHandoff: Component<{ sessionID: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const data = useData()
  const server = useServer()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const [brief, setBrief] = createSignal("")
  const [generating, setGenerating] = createSignal(true)
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [logs, setLogs] = createSignal<HandoffLog[]>([])
  const [errorDetails, setErrorDetails] = createSignal("")
  const [elapsed, setElapsed] = createSignal(0)
  const [offsetX, setOffsetX] = createSignal(0)
  const [offsetY, setOffsetY] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  let logID = 0
  let activeLogID: number | undefined
  let startedAt = 0
  let controller: AbortController | undefined

  let drag:
    | {
        readonly pointerId: number
        readonly startX: number
        readonly startY: number
        readonly startOffsetX: number
        readonly startOffsetY: number
        readonly maxOffsetX: number
        readonly maxOffsetY: number
      }
    | undefined

  const millisecondFormatter = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "unit",
        unit: "millisecond",
        unitDisplay: "short",
        maximumFractionDigits: 2,
      }),
  )

  const secondFormatter = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }),
  )

  const finishLog = (label?: string, status: "done" | "failed" = "done") => {
    const id = activeLogID

    if (id === undefined) return
    activeLogID = undefined
    const finishedAt = performance.now()

    setLogs((items) =>
      items.map((item) =>
        item.id === id ? { ...item, label: label ?? item.label, finishedAt, status } : item,
      ),
    )
  }

  const startLog = (emoji: string, label: string) => {
    finishLog()
    const startedAt = performance.now()
    const id = ++logID

    activeLogID = id
    setLogs((items) => [...items, { id, emoji, label, startedAt, status: "running" }])
  }

  const addMeasuredLog = (
    emoji: string,
    label: string,
    stepStartedAt: number,
    status: "done" | "failed" = "done",
  ) =>
    setLogs((items) => [
      ...items,
      {
        id: ++logID,
        emoji,
        label,
        startedAt: stepStartedAt,
        finishedAt: performance.now(),
        status,
      },
    ])

  const begin = () => {
    startedAt = performance.now()
    activeLogID = undefined
    setElapsed(0)
  }

  createEffect(() => {
    if (!generating() && !busy()) return

    const timer = setInterval(() => setElapsed(performance.now() - startedAt), 200)

    onCleanup(() => clearInterval(timer))
  })

  onCleanup(() => controller?.abort())

  const generate = async () => {
    setGenerating(true)
    setFailed(false)
    setErrorDetails("")
    setLogs([])
    begin()

    try {
      const info = data.session.get(props.sessionID)

      if (!info?.model) throw new Error("Session model is unavailable")

      const readStartedAt = performance.now()
      const messages = data.session.message.list(props.sessionID)

      addMeasuredLog("📚", language.t("dialog.handoff.progress.read", { count: messages.length }), readStartedAt)

      const contextStartedAt = performance.now()
      const transcript = renderHandoffTranscript(messages)

      addMeasuredLog(
        "🧩",
        language.t("dialog.handoff.progress.context", { count: transcript.length }),
        contextStartedAt,
      )

      const model = `${info.model.providerID}/${info.model.id}`
      startLog("🧠", language.t("dialog.handoff.progress.requesting", { model }))

      controller = new AbortController()

      const result = await serverSDK.api.experimental.generate.text({
        model: info.model,
        prompt: renderHandoffPrompt(transcript),
      }, { signal: controller.signal })

      finishLog(language.t("dialog.handoff.progress.received", { count: result.text.length }))
      setBrief(result.text)
    } catch (error) {
      if (controller?.signal.aborted) return

      const details = error instanceof Error ? formatError(error) : errorMessage(error, String(error))

      console.error("[handoff] generation failed", error)
      setErrorDetails(details)
      setFailed(true)
      const label = language.t("dialog.handoff.progress.failed", { seconds: seconds() })

      if (activeLogID === undefined) addMeasuredLog("💥", label, startedAt, "failed")
      else finishLog(label, "failed")
    } finally {
      setElapsed(performance.now() - startedAt)
      setGenerating(false)
    }
  }

  onMount(() => void generate())

  const start = async () => {
    const text = brief().trim()

    if (!text || busy()) return
    setBusy(true)
    setErrorDetails("")
    begin()
    startLog("🌱", language.t("dialog.handoff.progress.creating"))

    try {
      const info = data.session.get(props.sessionID)

      const created = await serverSDK.api.session.create({
        title: info ? `↪ ${info.title}` : undefined,
        agent: info?.agent,
        model: info?.model,
        location: info ? { directory: info.location.directory } : undefined,
        metadata: { handoffFrom: { id: props.sessionID, title: info?.title ?? "" } },
      })

      finishLog()
      startLog("🚀", language.t("dialog.handoff.progress.starting"))
      await serverSDK.api.session.prompt({ sessionID: created.id, text: renderHandoffStartPrompt(text) })
      finishLog()
      dialog.close()
      navigate(sessionHref(server.key, created.id))
    } catch (error) {
      const details = error instanceof Error ? formatError(error) : errorMessage(error, String(error))

      console.error("[handoff] start failed", error)
      setErrorDetails(details)
      finishLog(language.t("dialog.handoff.progress.failed", { seconds: seconds() }), "failed")
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      })
      setElapsed(performance.now() - startedAt)
      setBusy(false)
    }
  }

  const canStart = () => !busy() && !generating() && !failed()
  const seconds = () => (elapsed() / 1_000).toFixed(1)

  const visible = createMemo(() => {
    const route = layout.route()

    return route.type === "session" && route.server === server.key && route.sessionId === props.sessionID
  })

  const status = () => {
    if (generating()) return language.t("dialog.handoff.progress.waiting", { seconds: seconds() })

    if (busy()) return language.t("dialog.handoff.starting")

    if (failed() || errorDetails()) return language.t("dialog.handoff.progress.finishedFailed", { seconds: seconds() })

    return language.t("dialog.handoff.progress.finished", { seconds: seconds() })
  }

  const logSeconds = (item: HandoffLog) => {
    void elapsed()
    const finishedAt = item.finishedAt ?? startedAt + elapsed()
    const duration = Math.max(0, finishedAt - item.startedAt)

    return duration < 1_000 ? millisecondFormatter().format(duration) : secondFormatter().format(duration / 1_000)
  }

  const beginDrag = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0) return
    const container = event.currentTarget.closest<HTMLElement>('[data-slot="dialog-container"]')

    if (!container) return
    const bounds = container.getBoundingClientRect()

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offsetX(),
      startOffsetY: offsetY(),
      maxOffsetX: Math.max(0, (window.innerWidth - bounds.width) / 2 - 8),
      maxOffsetY: Math.max(0, (window.innerHeight - bounds.height) / 2 - 8),
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextX = drag.startOffsetX + event.clientX - drag.startX
    const nextY = drag.startOffsetY + event.clientY - drag.startY

    setOffsetX(Math.max(-drag.maxOffsetX, Math.min(drag.maxOffsetX, nextX)))
    setOffsetY(Math.max(-drag.maxOffsetY, Math.min(drag.maxOffsetY, nextY)))
  }

  const endDrag = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!drag || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    drag = undefined
    setDragging(false)
  }

  return (
    <Dialog
      containerClass={`handoff-dialog${dragging() ? " is-dragging" : ""}`}
      containerStyle={{
        display: visible() ? undefined : "none",
        transform: `translate(${offsetX()}px, ${offsetY()}px)`,
      }}
      preventBackdropDismiss
      preventEscapeDismiss={!visible()}
    >
      <DialogHeader>
        <div
          class="handoff-drag-handle"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <DialogTitleGroup
            title={language.t("dialog.handoff.title")}
            description={language.t("dialog.handoff.description")}
          />
        </div>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col px-4 py-3">
        <Show when={logs().length > 0 || failed() || errorDetails()}>
          <div class="handoff-progress mb-3 shrink-0 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3">
            <div class="flex items-center gap-2 text-[13px] text-v2-text-text-base" role="status" aria-live="polite">
              <Show when={generating() || busy()}>
                <Spinner width={14} height={14} class="handoff-progress-spinner" />
              </Show>
              <span class="font-[530]">{status()}</span>
            </div>
            <div class="mt-2 flex flex-col gap-1.5">
              <For each={logs()}>
                {(item) => (
                  <div
                    data-slot="handoff-progress-step"
                    data-status={item.status}
                    class="handoff-progress-step text-[12px] leading-5"
                  >
                    <span aria-hidden="true" class="handoff-progress-emoji">
                      {item.emoji}
                    </span>
                    <span class="min-w-0 truncate">{item.label}</span>
                    <span class="tabular-nums">{logSeconds(item)}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={errorDetails()}>
              {(details) => (
                <div class="mt-3 flex flex-col gap-1">
                  <div class="text-[12px] font-[530] text-v2-state-fg-danger">
                    {language.t("dialog.handoff.error.details")}
                  </div>
                  <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-v2-background-bg-base p-2 text-[12px] leading-5 text-v2-text-text-muted">
                    {details()}
                  </pre>
                </div>
              )}
            </Show>
          </div>
        </Show>
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
        <Button type="button" variant="neutral" disabled={busy()} onClick={() => {
          controller?.abort()
          dialog.close()
        }}>
          {language.t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="contrast"
          class="handoff-start-button"
          disabled={!canStart()}
          onClick={() => void start()}
        >
          {busy() ? language.t("dialog.handoff.starting") : language.t("dialog.handoff.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function formatError(error: Error) {
  return `${error.message}\n\n${error.stack ?? ""}`.trim()
}
