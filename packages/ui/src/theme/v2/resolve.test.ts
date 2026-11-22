import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import type { DesktopTheme, HexColor, ResolvedV2Theme } from "../types"
import { resolveThemeVariant } from "../resolve"
import { resolveThemeV2, resolveThemeVariantV2, themeV2ToCss } from "./resolve"

const theme: DesktopTheme = await Bun.file(new URL("../themes/oc-2.json", import.meta.url)).json()

test("the new light and dark themes keep base text readable", async () => {
  const ids = ["porcelain-blue", "sea-glass", "glacier-mist", "matcha-air", "latte-violet"]

  for (const id of ids) {
    // SAFETY: these repository-owned theme files follow desktop-theme.schema.json.
    const next = (await Bun.file(new URL(`../themes/${id}.json`, import.meta.url)).json()) as DesktopTheme

    for (const mode of ["light", "dark"] as const) {
      const tokens = resolveThemeVariantV2(next[mode], mode === "dark")
      const background = resolveToken(tokens, "v2-background-bg-base")
      const text = resolveToken(tokens, "v2-text-text-base")
      const legacy = resolveThemeVariant(next[mode], mode === "dark")

      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(resolveToken(legacy, legacy["text-base"]), resolveToken(legacy, legacy["background-base"])),
      ).toBeGreaterThanOrEqual(4.5)
    }
  }
})

describe("icon emphasis", () => {
  test.each(["light", "dark"] as const)("OC-2 %s icons increase in contrast from faint to base", (mode) => {
    expectIconEmphasis(resolveThemeV2(theme)[mode])
  })

  test.each([false, true])("custom theme fallbacks preserve icon emphasis (dark: %s)", (dark) => {
    expectIconEmphasis(resolveThemeVariantV2({ ...theme[dark ? "dark" : "light"], v2Overrides: undefined }, dark))
  })
})

describe("contrast icon-button tokens", () => {
  test("OC-2 dark mode uses a light background and an inverse icon matching the base surface", () => {
    const tokens = resolveThemeV2(theme).dark
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("var(--v2-grey-400)")
    expect(tokens["v2-grey-400"]).toBe("#dbdbdbff")
    expect(tokens["v2-icon-icon-inverse"]).toBe(tokens["v2-background-bg-base"])
    expect(tokens["v2-grey-1100"]).toBe("#161616ff")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-700)")
    expect(tokens["v2-text-text-contrast"]).toBe("var(--v2-grey-50)")
  })

  test("OC-2 light mode retains the existing contrast background and foreground", () => {
    const tokens = resolveThemeV2(theme).light
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("var(--v2-background-bg-contrast)")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-1000)")
    expect(tokens["v2-text-text-contrast"]).toBe("var(--v2-grey-50)")
  })

  test.each([false, true])("custom themes without the new token receive a fallback (dark: %s)", (dark) => {
    const tokens = resolveThemeVariantV2({ ...theme.dark, v2Overrides: undefined }, dark)
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe(
      dark ? "var(--v2-grey-400)" : "var(--v2-background-bg-contrast)",
    )
    expect(themeV2ToCss(tokens)).toContain(
      `--v2-background-bg-icon-button-contrast: ${tokens["v2-background-bg-icon-button-contrast"]};`,
    )
  })

  test("custom themes can override the icon-button background independently", () => {
    const tokens = resolveThemeVariantV2(
      {
        ...theme.dark,
        v2Overrides: { ...theme.dark.v2Overrides, "v2-background-bg-icon-button-contrast": "#dddddd" },
      },
      true,
    )

    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("#dddddd")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-700)")
  })
})

describe("input elevation", () => {
  test.each([
    {
      mode: "light",
      input:
        "0px 1px 1.5px 0px var(--v2-alpha-dark-10), 0px 0px 0px 0.5px var(--v2-alpha-dark-14), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
      button:
        "0px 1px 1.5px 0px var(--v2-alpha-dark-10), 0px 0px 0px 0.5px var(--v2-alpha-dark-14), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
    },
    {
      mode: "dark",
      input:
        "0px 1px 2px 0px var(--v2-alpha-dark-0), 0px 0px 0px 0.5px var(--v2-alpha-light-16), 0px -0.5px 0px 0px var(--v2-alpha-light-6)",
      button:
        "0px 1px 2px 0px var(--v2-alpha-dark-40), 0px 0px 0px 0.5px var(--v2-alpha-light-20), 0px -0.5px 0px 0px var(--v2-alpha-light-10)",
    },
  ] as const)(
    "$mode matches Figma in OC-2 and custom-theme fallbacks without changing buttons",
    ({ mode, input, button }) => {
      for (const tokens of [
        resolveThemeV2(theme)[mode],
        resolveThemeVariantV2({ ...theme[mode], v2Overrides: undefined }, mode === "dark"),
      ]) {
        expect(tokens["v2-elevation-input"]).toBe(input)
        expect(tokens["v2-elevation-button-neutral"]).toBe(button)
      }
    },
  )
})

function expectIconEmphasis(tokens: ResolvedV2Theme) {
  // SAFETY: these resolved background/icon color tokens are hex colors or references to other hex color tokens.
  const resolve = (value: string): HexColor => resolveToken(tokens, value)

  const background = resolve(tokens["v2-background-bg-base"])
  const contrast = (role: string) => contrastRatio(resolve(tokens[`v2-icon-icon-${role}`]), background)
  expect(contrast("faint")).toBeLessThan(contrast("muted"))
  expect(contrast("muted")).toBeLessThan(contrast("base"))
}

function resolveToken(tokens: Record<string, string | undefined>, value: string): HexColor {
  const token = tokens[value] ?? (value.startsWith("var(--") ? tokens[value.slice(6, -1)] : value)

  if (!token) throw new Error(`Unresolved theme token: ${value}`)

  if (token.startsWith("var(--")) return resolveToken(tokens, token)

  // SAFETY: callers resolve base color tokens, which are hex values after following variable references.
  return token as HexColor
}
