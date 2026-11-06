import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { assistantMessage, setupTimeline, shell, userMessage } from "../utils/timeline"

const narrative = "I’ll inspect the current diff before changing anything."

test("shows the current step while keeping a live tool group collapsed", async ({ page }) => {
  await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [
      userMessage(),
      assistantMessage(
        [
          { id: "prt_narrative", type: "text", text: narrative },
          shell("prt_narrative_shell", "running", "checking", "git diff --check"),
        ],
        { completed: false },
      ),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const trigger = group.locator('[data-component="context-tool-group-trigger"]')
  const toggle = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toHaveAttribute("aria-label", `${narrative} Used 1 Shell`)
  await expect(group.getByText("git diff --check", { exact: true })).not.toBeVisible()

  await toggle.click()
  await expect(group.getByText("git diff --check", { exact: true })).toBeVisible()
})

test("keeps the final synthesis outside the collapsed activity group", async ({ page }) => {
  const conclusion = "Review complete. The current diff has no blocking issues."

  await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [
      userMessage(),
      assistantMessage([
        { id: "prt_complete_narrative", type: "text", text: narrative },
        shell("prt_complete_shell", "completed", "checked", "git diff --check"),
        { id: "prt_complete_summary", type: "text", text: conclusion },
      ]),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  await expect(
    group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]'),
  ).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByText(conclusion, { exact: true })).toBeVisible()
})
