import { Component, Show, createSignal, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import "./dialog-handoff.css"

// The generated client returns either `{ data, error }` or the payload directly
// depending on how it was configured, so tolerate both shapes.
type PreviewShape = { data?: { brief?: string }; brief?: string; error?: unknown }
type StartShape = {
  data?: { sessionID?: string; title?: string }
  sessionID?: string
  title?: string
  error?: unknown
}

export const DialogHandoff: Component<{ sessionID: string }> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()

  const [brief, setBrief] = createSignal("")
  const [generating, setGenerating] = createSignal(true)
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal(false)



  const generate = async () => {
    setGenerating(true)
    setFailed(false)
    try {
      const result = (await sdk().client.session.handoffPreview({ sessionID: props.sessionID })) as unknown as PreviewShape
      if (result.error) throw new Error(String(result.error))
      setBrief(result.data?.brief ?? result.brief ?? "")
    } catch {
      setFailed(true)
    } finally {
      setGenerating(false)
    }
  }

  onMount(() => void generate())

  const start = async () => {
    const text = brief().trim()
    if (!text) {
      showToast({ title: language.t("common.requestFailed"), description: language.t("dialog.handoff.empty") })
      return
    }
    if (busy()) return
    setBusy(true)
    try {
      const result = (await sdk().client.session.handoffStart({
        sessionID: props.sessionID,
        brief: text,
      })) as unknown as StartShape
      const data = result.data ?? result
      if (result.error || !data.sessionID) throw new Error(String(result.error ?? language.t("common.requestFailed")))
      dialog.close()
      navigate(`/${base64Encode(sdk().directory)}/session/${data.sessionID}`)
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
      <DividerV2 />
      <DialogBody class="flex min-h-0 flex-1 flex-col px-4 py-4">
        {/* Kobalte focuses the first tabbable element on open when nothing opts into
            `autofocus`, which lands on the close button. Focus this inert target instead
            so the close button only shows its focus ring on real keyboard focus. */}
        <div autofocus tabindex="-1" class="flex min-h-0 flex-1 flex-col gap-3 outline-none">
          <Show
            when={!generating()}
            fallback={
              <div class="flex min-h-0 flex-1 items-center justify-center text-[13px] text-v2-text-text-muted">
                {language.t("dialog.handoff.generating")}
              </div>
            }
          >
            <Show
              when={!failed()}
              fallback={
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                  <div class="text-[13px] text-v2-state-fg-danger">{language.t("dialog.handoff.failed")}</div>
                  <ButtonV2 type="button" variant="neutral" onClick={() => void generate()}>
                    {language.t("dialog.handoff.retry")}
                  </ButtonV2>
                </div>
              }
            >
              <TextareaV2
                class="!min-h-0 !w-full !flex-1 [&_[data-slot=textarea-v2-textarea]]:font-mono"
                value={brief()}
                spellcheck={false}
                onInput={(event) => setBrief(event.currentTarget.value)}
              />
            </Show>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 type="button" variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 class="handoff-primary" type="button" variant="contrast" disabled={!canStart()} onClick={start}>
          {busy() ? language.t("dialog.handoff.starting") : language.t("dialog.handoff.confirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
