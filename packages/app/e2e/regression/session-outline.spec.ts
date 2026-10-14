import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, userMessage } from "../utils/timeline"
import { openSettings } from "../utils/workspace"

// The rail navigates turns, so it needs two of them to have anything to show.
const turns = () => [
  userMessage(undefined, { id: "msg_outline_first" }),
  assistantMessage(undefined, { id: "msg_outline_first_reply", parentID: "msg_outline_first" }),
  userMessage(undefined, { id: "msg_outline_second" }),
  assistantMessage(undefined, { id: "msg_outline_second_reply", parentID: "msg_outline_second" }),
]

const rail = (page: import("@playwright/test").Page) => page.locator(".session-outline")

async function sides(page: import("@playwright/test").Page) {
  const panel = page.locator('[data-slot="session-chat-panel"]')
  const [railBox, panelBox] = await Promise.all([rail(page).boundingBox(), panel.boundingBox()])

  if (!railBox || !panelBox) throw new Error("the outline and the chat panel must both be laid out")

  return { railCentre: railBox.x + railBox.width / 2, panelCentre: panelBox.x + panelBox.width / 2 }
}

test("keeps the session outline on the right edge by default", async ({ page }) => {
  await setupTimeline(page, { viewport: { width: 1440, height: 900 }, messages: turns() })
  await expect(rail(page)).toHaveAttribute("data-side", "right")

  const { railCentre, panelCentre } = await sides(page)
  expect(railCentre).toBeGreaterThan(panelCentre)
})

test("moves the session outline to the left edge it is configured for", async ({ page }) => {
  await setupTimeline(page, {
    viewport: { width: 1440, height: 900 },
    settings: { outlineSide: "left" },
    messages: turns(),
  })
  await expect(rail(page)).toHaveAttribute("data-side", "left")

  const { railCentre, panelCentre } = await sides(page)
  expect(railCentre).toBeLessThan(panelCentre)
})

test("offers the outline sides in settings, left or right", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "Outline sides" })
  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()

  const trigger = page.locator('[data-action="settings-outline-side"]')
  await expect(trigger.getByRole("button", { name: "Right", exact: true })).toBeVisible()

  await trigger.click()
  await page.getByRole("option", { name: "Left", exact: true }).click()
  await expect(trigger.getByRole("button", { name: "Left", exact: true })).toBeVisible()
})
