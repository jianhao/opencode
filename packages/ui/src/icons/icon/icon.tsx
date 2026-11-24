import { createSignal, onMount, type ComponentProps, splitProps } from "solid-js"
import { iconNames, isIconName, getIcon, type IconName } from "../catalog"
import { iconTone } from "./tones"
import "./icon.css"

const spriteID = "opencode-v2-icon-sprite"

const symbol = (name: IconName) => `opencode-v2-icon-${name}`

let spriteInserted = false

export type IconStyle = "line" | "plate"

// 外观设置整档切换图标套装：line 纯线性，plate 线条 + 同色浅底。
const [currentIconStyle, setCurrentIconStyle] = createSignal<IconStyle>("line")

export function setIconStyle(style: IconStyle) {
  setCurrentIconStyle(style)

  if (typeof document !== "undefined") document.documentElement.dataset.iconStyle = style
}

export { currentIconStyle }

if (typeof document !== "undefined") document.documentElement.dataset.iconStyle = currentIconStyle()

function spriteContent() {
  return iconNames()
    .map((name) => `<symbol id="${symbol(name)}" viewBox="${getIcon(name).viewBox}">${getIcon(name).body}</symbol>`)
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
  const pixelSize = () => (split.size === "large" ? 20 : split.size === "small" ? 14 : 16)
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
      viewBox={icon().viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <use href={`#${symbol(iconName())}`} />
    </svg>
  )
}
