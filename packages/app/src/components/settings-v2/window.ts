import { onCleanup } from "solid-js"

const STORAGE_KEY = "opencode.settings.window.v2"
const MARGIN = 8
const MIN_WIDTH = 720
const MIN_HEIGHT = 480
const DEFAULT_WIDTH = 1250
const DEFAULT_HEIGHT = 765

type WindowState = { x: number; y: number; width: number; height: number }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function read(): WindowState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const value = JSON.parse(raw) as Partial<WindowState>
    const numbers = [value.x, value.y, value.width, value.height]
    if (numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return value as WindowState
  } catch {
    return
  }
  return
}

function write(state: WindowState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // persistence is best effort (storage may be unavailable or full)
  }
}

// Makes the v2 settings dialog behave like a small window: drag by the top
// strip, resize from the bottom-right grip, and remember position/size.
export function attachSettingsWindow(container: HTMLElement) {
  const drag = container.querySelector<HTMLElement>('[data-slot="settings-drag-handle"]')
  const resize = container.querySelector<HTMLElement>('[data-slot="settings-resize-handle"]')
  if (!drag || !resize) return

  const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2)
  const maxHeight = () => Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2)

  const stored = read()
  const state: WindowState = {
    x: 0,
    y: 0,
    width: clamp(stored?.width ?? DEFAULT_WIDTH, MIN_WIDTH, maxWidth()),
    height: clamp(stored?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT, maxHeight()),
  }
  state.x = clamp(stored?.x ?? (window.innerWidth - state.width) / 2, MARGIN, window.innerWidth - state.width - MARGIN)
  state.y = clamp(stored?.y ?? (window.innerHeight - state.height) / 2, MARGIN, window.innerHeight - state.height - MARGIN)

  const apply = () => {
    container.style.position = "fixed"
    container.style.left = `${state.x}px`
    container.style.top = `${state.y}px`
    container.style.width = `${state.width}px`
    container.style.height = `${state.height}px`
    container.style.transform = "none"
    container.style.margin = "0"
  }
  apply()
  write(state)

  let active: { mode: "move" | "resize"; startX: number; startY: number; origin: WindowState } | undefined

  const down = (mode: "move" | "resize") => (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    active = { mode, startX: event.clientX, startY: event.clientY, origin: { ...state } }
    container.dataset.windowActive = ""
  }

  const move = (event: PointerEvent) => {
    if (!active) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (active.mode === "move") {
      state.x = clamp(active.origin.x + dx, MARGIN, window.innerWidth - state.width - MARGIN)
      state.y = clamp(active.origin.y + dy, MARGIN, window.innerHeight - state.height - MARGIN)
    } else {
      state.width = clamp(active.origin.width + dx, MIN_WIDTH, maxWidth())
      state.height = clamp(active.origin.height + dy, MIN_HEIGHT, maxHeight())
    }
    apply()
  }

  const up = () => {
    if (!active) return
    active = undefined
    delete container.dataset.windowActive
    write(state)
  }

  const onResize = () => {
    state.width = clamp(state.width, MIN_WIDTH, maxWidth())
    state.height = clamp(state.height, MIN_HEIGHT, maxHeight())
    state.x = clamp(state.x, MARGIN, window.innerWidth - state.width - MARGIN)
    state.y = clamp(state.y, MARGIN, window.innerHeight - state.height - MARGIN)
    apply()
    write(state)
  }

  const startMove = down("move")
  const startResize = down("resize")

  drag.addEventListener("pointerdown", startMove)
  resize.addEventListener("pointerdown", startResize)
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", up)
  window.addEventListener("resize", onResize)

  onCleanup(() => {
    drag.removeEventListener("pointerdown", startMove)
    resize.removeEventListener("pointerdown", startResize)
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", up)
    window.removeEventListener("resize", onResize)
  })
}
