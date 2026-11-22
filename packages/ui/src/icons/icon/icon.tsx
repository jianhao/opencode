import { createSignal, onMount, type ComponentProps, splitProps } from "solid-js"
import { iconNames, isIconName, getIcon, type IconName } from "../catalog"
import { getNewIcon, newIconViewBox } from "../new-icons"
import { iconTone } from "./tones"
import "./icon.css"

const spriteID = "opencode-v2-icon-sprite"

const symbol = (name: IconName) => `opencode-v2-icon-${name}`

const newSymbol = (name: IconName) => `opencode-v2-icon-new-${name}`

let spriteInserted = false

export type IconStyle = "linear" | "duotone" | "ink"

// The app applies this from Settings > Appearance. The attribute lets CSS tune icon frames and stroke weight.
const [currentIconStyle, setCurrentIconStyle] = createSignal<IconStyle>("duotone")

export function setIconStyle(style: IconStyle) {
  setCurrentIconStyle(style)

  if (typeof document !== "undefined") document.documentElement.dataset.iconStyle = style
}

export { currentIconStyle }

if (typeof document !== "undefined") document.documentElement.dataset.iconStyle = currentIconStyle()

function spriteContent() {
  return iconNames()
    .map((name) => {
      const current = `<symbol id="${symbol(name)}" viewBox="${getIcon(name).viewBox}">${getIcon(name).body}</symbol>`
      const next = getNewIcon(name)

      return next ? `${current}<symbol id="${newSymbol(name)}" viewBox="${newIconViewBox}">${next}</symbol>` : current
    })
    .join("")
}

function ensureSprite() {
  if (spriteInserted) return

  if (typeof document === "undefined") return
  // Hot reload preserves the DOM sprite, but its symbols may be from an older module.
  const existing = document.getElementById(spriteID)

  if (existing) {
    existing.innerHTML = spriteContent()
    spriteInserted = true

    return
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = spriteContent()
  document.body.insertBefore(svg, document.body.firstChild)
  spriteInserted = true
}

export interface IconProps extends ComponentProps<"svg"> {
  name: IconName | (string & {})
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])

  const iconName = (): IconName => {
    return isIconName(split.name) ? split.name : "plus"
  }

  const icon = () => getIcon(iconName())
  // Names without redesigned artwork keep their current path until their replacement lands.
  const next = () => getNewIcon(iconName()) !== undefined
  // New artwork is drawn on a 16px grid, so it stays at 16px where today's small icons shrink to 14px.
  const pixelSize = () => (split.size === "large" ? 20 : split.size === "small" && !next() ? 14 : 16)
  onMount(ensureSprite)

  return (
    <svg
      {...rest}
      data-slot="icon-svg"
      data-icon-style={currentIconStyle()}
      data-icon-tone={iconTone(iconName())}
      data-directional={
        iconName() === "arrow-left" ||
        iconName() === "arrow-right" ||
        iconName() === "outline-arrow-left" ||
        iconName() === "outline-arrow-right" ||
        iconName() === "outline-chevron-right" ||
        iconName() === "chevron-left" ||
        iconName() === "chevron-right"
          ? ""
          : undefined
      }
      width={pixelSize()}
      height={pixelSize()}
      viewBox={next() ? newIconViewBox : icon().viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <use href={`#${next() ? newSymbol(iconName()) : symbol(iconName())}`} />
    </svg>
  )
}
