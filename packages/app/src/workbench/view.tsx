import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { parseRichText } from "@opencode/util/rich-text"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { Loader } from "@opencode/ui/loader"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider } from "@opencode/session-ui/context/markdown"
import { DEFAULT_DETAIL_CONFIG } from "./types"
import type {
  WorkbenchComment,
  WorkbenchDetail,
  WorkbenchDetailConfig,
  WorkbenchItem,
  WorkbenchPreflight,
  WorkbenchSubItem,
  WorkbenchTask,
  WorkbenchTaskDocs,
} from "./types"
import type { createWorkbenchController } from "./model"
import type { WorkbenchRuns } from "./runs"
import { safeRichText } from "./sanitize"
import { statusTone, type StatusTone } from "./status-tone"
import "./view.css"

type Controller = ReturnType<typeof createWorkbenchController>

const SKELETON_CARDS = Array.from({ length: 9 }, (_, index) => index)

const SKELETON_TABS = [62, 74, 58, 70, 54, 66, 48]

const CATEGORY: Record<WorkbenchItem["category"], string> = {
  Req: "需求",
  Task: "任务",
  Bug: "缺陷",
  Other: "其他",
}

// 明文 HTTP 来源没有 navigator.clipboard，退回到选中 textarea 的方式复制。
async function copyText(text: string) {
  const written = await navigator.clipboard?.writeText(text).then(
    () => true,
    () => false,
  )

  if (written) return true
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.tabIndex = -1
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  active?.focus({ preventScroll: true })

  return copied
}

// 复制这类轻反馈走顶部消息，不在卡片上原地变形。
const [message, setMessage] = createSignal("")

let messageTimer: ReturnType<typeof setTimeout> | undefined

function notify(text: string) {
  setMessage(text)
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => setMessage(""), 1800)
}

const stamp = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function absolute(value?: string) {
  if (!value) return "—"

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? value : stamp.format(date)
}

// 云效号点一下就复制：列表里最常被拿去搜索/贴进对话的就是它。
function Serial(props: { value: string }) {
  const copy = async (event: MouseEvent) => {
    event.stopPropagation()

    if (await copyText(props.value)) notify("已复制云效号")
  }

  return (
    <button type="button" class="workbench-serial" title={`复制 ${props.value}`} onClick={copy}>
      <span>{props.value}</span>
      <Icon name="copy" size="small" class="workbench-serial-icon" />
    </button>
  )
}

function relative(value?: string) {
  if (!value) return ""
  const delta = Date.now() - new Date(value).getTime()

  if (Number.isNaN(delta)) return ""
  const minutes = Math.round(delta / 60000)

  if (minutes < 60) return `${Math.max(minutes, 1)} 分钟前`
  const hours = Math.round(minutes / 60)

  if (hours < 24) return `${hours} 小时前`

  return `${Math.round(hours / 24)} 天前`
}

// 云效优先级名（紧急/高/中/低）；缺名称时回退到 P0-P3。
function priorityLabel(item: WorkbenchItem) {
  if (item.priorityName) return item.priorityName

  switch (item.priority) {
    case "P0":
      return "紧急"
    case "P1":
      return "高"
    case "P2":
      return "中"
    case "P3":
      return "低"
    default:
      return item.priority ?? ""
  }
}

// 优先级色值照抄 yunxiao-web 的 getPriorityColor：P0/P1=error、P2=warning、P3=success。
function priorityTone(item: WorkbenchItem) {
  const label = priorityLabel(item)

  if (label === "紧急" || label === "高") return "error"

  if (label === "中") return "warning"

  if (label === "低") return "success"

  return "default"
}

export function WorkbenchView(props: { controller: Controller; runs: WorkbenchRuns; desktop: boolean }) {
  const snapshot = () => props.controller.snapshot()
  const selected = createMemo(() => props.controller.items().find((item) => item.id === props.controller.selected()))
  const [tokenInput, setTokenInput] = createSignal("")
  const [configOpen, setConfigOpen] = createSignal(false)
  const dialog = useDialog()
  const configured = () => props.desktop && snapshot()?.token.configured

  // 首页要像一块常亮的控制台：日期与时间自己走，不必等刷新。
  const [now, setNow] = createSignal(new Date())

  if (typeof window !== "undefined") {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    onCleanup(() => clearInterval(timer))
  }

  let toolbar: HTMLDivElement | undefined

  const total = () => {
    const counts = props.controller.readiness()

    return counts.ready + counts.clarify + counts.blocked
  }

  // 点抽屉以外的空白处直接关掉详情；点到卡片或控件时保留它们自己的行为。
  let configAnchor: HTMLDivElement | undefined

  // 配置菜单是常驻的：只有点到菜单外面才收起。
  const onConfigPointerDown = (event: PointerEvent) => {
    if (!configOpen()) return

    if (!(event.target instanceof Node)) return

    if (configAnchor?.contains(event.target)) return

    setConfigOpen(false)
  }

  if (typeof document !== "undefined") document.addEventListener("pointerdown", onConfigPointerDown, true)
  onCleanup(() => document.removeEventListener("pointerdown", onConfigPointerDown, true))

  const onPointerDown = (event: PointerEvent) => {
    if (!props.controller.selected()) return

    if (!(event.target instanceof Element)) return

    const interactive = event.target.closest("button, a, input, select, textarea, [role='tab'], .workbench-detail")

    if (interactive) return

    props.controller.close()
  }

  if (typeof document !== "undefined") document.addEventListener("pointerdown", onPointerDown, true)
  onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))

  return (
    <div class="workbench-shell">
      <Show when={message()}>{(text) => <div class="workbench-message">{text()}</div>}</Show>
      <header class="workbench-header">
        <div class="workbench-title">
          <h1>工作台</h1>
          <p>当前需要你关注的事项</p>
        </div>
        <div class="workbench-header-spacer" />
        <Show when={snapshot()?.token.configured}>
          <span class="workbench-sync">
            <i />
            <span>{snapshot()?.token.userName}</span>
            <span>·</span>
            <span>{relative(new Date(snapshot()!.fetchedAt).toISOString())}</span>
          </span>
        </Show>
        <Show when={configured()}>
          <label class="workbench-search">
            <Icon name="magnifying-glass" size="small" />
            <input
              value={props.controller.query()}
              placeholder="搜索云效号 / 标题 / 项目"
              onInput={(event) => props.controller.setQuery(event.currentTarget.value)}
            />
            <span>{props.controller.items().length}</span>
          </label>
        </Show>
        <IconButton
          class="workbench-refresh"
          data-loading={props.controller.loading() ? "" : undefined}
          icon={<Icon name="refresh" />}
          variant="neutral"
          aria-label="刷新工作台"
          disabled={!configured() || props.controller.loading()}
          onClick={() => void props.controller.refresh()}
        />
        <div class="workbench-config-anchor" ref={configAnchor}>
          <IconButton
            icon={<Icon name="sliders" />}
            variant="ghost-muted"
            aria-label="工作台配置"
            aria-haspopup="menu"
            aria-expanded={configOpen()}
            disabled={!configured()}
            onClick={() => setConfigOpen((open) => !open)}
          />
          <Show when={configOpen()}>
            <div class="workbench-config-menu" role="menu" aria-label="工作台配置">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setConfigOpen(false)
                  void dialog.push(() => <StatusConfigDialog controller={props.controller} />)
                }}
              >
                <Icon name="outline-sliders" size="small" />
                云效状态配置
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setConfigOpen(false)
                  void dialog.push(() => <DetailConfigDialog controller={props.controller} />)
                }}
              >
                <Icon name="file-document" size="small" />
                云效详情配置
              </button>
            </div>
          </Show>
        </div>
      </header>

      <Show when={!props.desktop}>
        <WorkbenchEmpty title="工作台只在桌面端可用" detail="Web 版无法读取本地云效连接。" />
      </Show>

      <Show when={props.desktop && snapshot() && !snapshot()!.token.configured}>
        <div class="workbench-setup">
          <div class="workbench-setup-icon">
            <Icon name="keyboard" />
          </div>
          <div>
            <strong>连接云效</strong>
            <p>在 shell 中设置云效令牌，或粘贴一个只读令牌。</p>
          </div>
          <div class="workbench-setup-form">
            <input
              type="password"
              placeholder="云效访问令牌"
              value={tokenInput()}
              onInput={(event) => setTokenInput(event.currentTarget.value)}
            />
            <button
              type="button"
              disabled={!tokenInput().trim()}
              onClick={() => void props.controller.saveToken(tokenInput().trim())}
            >
              保存
            </button>
          </div>
        </div>
      </Show>

      <Show when={props.desktop && snapshot()?.error}>{(error) => <div class="workbench-error">{error()}</div>}</Show>

      <Show when={props.desktop && !snapshot()}>
        <WorkbenchSkeleton />
      </Show>

      <Show when={configured() && snapshot() && !snapshot()!.error}>
        <div class="workbench-body">
          <div class="workbench-scroll" data-scrollable>
            <section class="workbench-hero" aria-label="今日概览">
              <div class="workbench-hero-visual" aria-hidden="true">
                <span class="workbench-glow" data-glow="accent" />
                <span class="workbench-glow" data-glow="info" />
                <span class="workbench-glow" data-glow="success" />
                <span class="workbench-hero-mesh" />
              </div>
              <div class="workbench-hero-inner">
                <div class="workbench-brief">
                  <p class="workbench-date">
                    <span>{weekday.format(now())}</span>
                    <i />
                    <span>{monthDay.format(now())}</span>
                    <i />
                    <span class="workbench-clock">{clock.format(now())}</span>
                  </p>
                  <h2 class="workbench-greeting">
                    {greetingOf(now().getHours())}，{snapshot()!.token.userName ?? "同学"}
                    <span>。</span>
                  </h2>
                  <p class="workbench-brief-line">
                    今天可开工 <b data-tone="ready">{props.controller.readiness().ready}</b> 件，
                    <b data-tone="clarify">{props.controller.readiness().clarify}</b> 件待补信息，
                    <b data-tone="blocked">{props.controller.readiness().blocked}</b> 件被阻塞。
                  </p>
                  <div class="workbench-brief-actions">
                    <Show
                      when={props.controller.focus()}
                      fallback={
                        <span class="workbench-brief-clear">
                          <Icon name="check" size="small" />
                          今天没有待处理的工作项
                        </span>
                      }
                    >
                      {(item) => (
                        <button type="button" class="workbench-primary" onClick={() => props.controller.open(item())}>
                          开始今天的第一件
                          <Icon name="arrow-right" size="small" />
                        </button>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="workbench-ghost"
                      onClick={() => toolbar?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      浏览全部 {total()} 项
                    </button>
                  </div>
                </div>

                <Show when={props.controller.focus()}>
                  {(item) => <Focus item={item()} onOpen={() => props.controller.open(item())} />}
                </Show>

                <HealthRing counts={props.controller.readiness()} total={total()} />
              </div>
            </section>

            <Show when={props.controller.inFlight().length || props.controller.decisions().length}>
              <div class="workbench-lanes">
                <Show when={props.controller.inFlight().length}>
                  <Lane
                    title="继续推进"
                    hint="已开工 · 接着做"
                    kind="active"
                    items={props.controller.inFlight()}
                    onOpen={(item) => props.controller.open(item)}
                  />
                </Show>
                <Show when={props.controller.decisions().length}>
                  <Lane
                    title="需要你拍板"
                    hint="阻塞 / 信息不全"
                    kind="stuck"
                    items={props.controller.decisions()}
                    onOpen={(item) => props.controller.open(item)}
                  />
                </Show>
              </div>
            </Show>

            <div class="workbench-toolbar" ref={toolbar}>
              <div class="workbench-toolbar-title">
                <h3>全部工作项</h3>
                <em>{props.controller.visibleTotal()}</em>
              </div>
              <div class="workbench-filters" role="tablist" aria-label="工作项筛选">
                <For each={props.controller.visibleStatuses()}>
                  {(status) => (
                    <Filter
                      value={status.count}
                      label={status.name}
                      status={status.name}
                      tone={status.tone}
                      active={props.controller.filter() === status.name}
                      onClick={() => props.controller.toggleFilter(status.name)}
                    />
                  )}
                </For>
              </div>
            </div>

            <div class="workbench-grid-section">
              <Show when={props.controller.items().length === 0}>
                <WorkbenchEmpty
                  title={props.controller.filter() === "all" ? "没有需要处理的工作项" : "这个状态下没有工作项"}
                  detail="切换状态筛选，或在状态标签里打开更多状态。"
                />
              </Show>
              <div class="workbench-grid">
                <For each={props.controller.items()}>
                  {(item) => (
                    <Card
                      item={item}
                      task={props.runs.taskFor(item.id)}
                      runs={props.runs}
                      active={item.id === props.controller.selected()}
                      onClick={() => props.controller.open(item)}
                    />
                  )}
                </For>
              </div>
            </div>

            <Show when={props.desktop && snapshot()?.warnings.length}>
              <div class="workbench-warning">部分项目空间拉取失败：{snapshot()!.warnings.length} 项</div>
            </Show>
          </div>

          <Show when={selected()}>
            {(item) => (
              // Portal 到 body：抽屉要相对整个窗口定位，不受内容区容器影响。
              <Portal>
                <aside class="workbench-detail" role="dialog" aria-label="工作项详情" data-scrollable>
                  <Show
                    when={!props.controller.detailLoading() && props.controller.detail()}
                    fallback={<DetailPlaceholder item={item()} onClose={props.controller.close} />}
                  >
                    {(detail) => <Detail detail={detail()} runs={props.runs} onClose={props.controller.close} />}
                  </Show>
                </aside>
              </Portal>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" })

const monthDay = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" })

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })

function greetingOf(hour: number) {
  if (hour < 5) return "夜深了"

  if (hour < 11) return "早上好"

  if (hour < 14) return "中午好"

  if (hour < 18) return "下午好"

  return "晚上好"
}

// 今日聚焦：把「现在最该动的这一件」提成一整张卡，点卡片直接开详情。
function Focus(props: { item: WorkbenchItem; onOpen: () => void }) {
  return (
    <div
      class="workbench-focus"
      role="button"
      tabindex="0"
      data-category={props.item.category}
      data-status-tone={statusTone(props.item.statusName)}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onOpen()
      }}
    >
      <div class="workbench-focus-head">
        <span class="workbench-focus-eyebrow">
          <i />
          今日聚焦
        </span>
        <span class="workbench-type">{CATEGORY[props.item.category]}</span>
        <span class="workbench-card-grow" />
        <span class="workbench-status">{props.item.statusName}</span>
      </div>
      <p class="workbench-focus-sub">
        <span>{props.item.serial}</span>
        <i />
        <span>{props.item.spaceName}</span>
      </p>
      <h3 class="workbench-focus-title">{props.item.title}</h3>
      <div class="workbench-focus-foot">
        <Show when={priorityLabel(props.item)}>
          <span class="workbench-priority" data-priority-tone={priorityTone(props.item)}>
            {priorityLabel(props.item)}
          </span>
        </Show>
        <span>{relative(props.item.updatedAt)}更新</span>
        <span class="workbench-card-grow" />
        <span class="workbench-focus-cta">
          进入处理
          <Icon name="arrow-right" size="small" />
        </span>
      </div>
    </div>
  )
}

// 健康环：可开工 / 需澄清 / 阻塞三段，用环形占比让「卡了多少」一眼可见。
function HealthRing(props: { counts: { ready: number; clarify: number; blocked: number }; total: number }) {
  const segments = () => {
    const sum = Math.max(props.total, 1)
    const gap = props.total > 3 ? 1.2 : 0

    const values = [
      { key: "ready", value: props.counts.ready },
      { key: "clarify", value: props.counts.clarify },
      { key: "blocked", value: props.counts.blocked },
    ].filter((segment) => segment.value > 0)

    let offset = 0

    return values.map((segment) => {
      const length = (segment.value / sum) * 100
      const result = { ...segment, length: Math.max(length - gap, 0.8), offset: offset + gap / 2 }
      offset += length

      return result
    })
  }

  return (
    <aside class="workbench-health" aria-label="工作项健康度">
      <div class="workbench-ring-wrap">
        <svg
          class="workbench-ring"
          viewBox="0 0 120 120"
          role="img"
          aria-label={`可开工 ${props.counts.ready}，需澄清 ${props.counts.clarify}，阻塞 ${props.counts.blocked}`}
        >
          <circle class="workbench-ring-track" cx="60" cy="60" r="50" pathLength="100" />
          <g class="workbench-ring-arcs">
            <For each={segments()}>
              {(segment) => (
                <circle
                  class="workbench-ring-arc"
                  data-tone={segment.key}
                  cx="60"
                  cy="60"
                  r="50"
                  pathLength="100"
                  stroke-dasharray={`${segment.length} ${100 - segment.length}`}
                  stroke-dashoffset={-segment.offset}
                />
              )}
            </For>
          </g>
        </svg>
        <div class="workbench-ring-center">
          <strong>{props.total}</strong>
          <span>待处理</span>
        </div>
      </div>
      <div class="workbench-health-legend">
        <span data-tone="ready">
          <i />
          可开工
          <b>{props.counts.ready}</b>
        </span>
        <span data-tone="clarify">
          <i />
          需澄清
          <b>{props.counts.clarify}</b>
        </span>
        <span data-tone="blocked">
          <i />
          阻塞
          <b>{props.counts.blocked}</b>
        </span>
      </div>
    </aside>
  )
}

// 泳道：继续推进 / 需要拍板。横向滚动，卡片点开详情。
function Lane(props: {
  title: string
  hint: string
  kind: "active" | "stuck"
  items: readonly WorkbenchItem[]
  onOpen: (item: WorkbenchItem) => void
}) {
  return (
    <section class="workbench-lane" data-kind={props.kind} aria-label={props.title}>
      <header>
        <span class="workbench-lane-icon">
          <Icon name={props.kind === "active" ? "arrow-right" : "warning"} size="small" />
        </span>
        <h3>{props.title}</h3>
        <em>{props.items.length}</em>
        <span class="workbench-card-grow" />
        <small>{props.hint}</small>
      </header>
      <div class="workbench-lane-track" data-scrollable>
        <For each={props.items.slice(0, 12)}>
          {(item) => {
            const reason = item.reasons.find((entry) => entry.level !== "pass")

            return (
              <button
                type="button"
                class="workbench-lane-card"
                data-status-tone={statusTone(item.statusName)}
                onClick={() => props.onOpen(item)}
              >
                <span class="workbench-lane-top">
                  <span class="workbench-lane-serial">{item.serial}</span>
                  <span class="workbench-lane-state">{item.statusName}</span>
                </span>
                <span class="workbench-lane-title">{item.title}</span>
                <span class="workbench-lane-foot">
                  <Show
                    when={props.kind === "stuck" && reason}
                    fallback={
                      <>
                        <span>{item.spaceName}</span>
                        <span class="workbench-card-grow" />
                        <span>{relative(item.updatedAt)}</span>
                      </>
                    }
                  >
                    {(entry) => <span data-level={entry().level}>{entry().message}</span>}
                  </Show>
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}

function Filter(props: {
  value: number
  label: string
  status: string
  tone: StatusTone
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      class="workbench-filter"
      data-status={props.status}
      data-status-tone={props.tone}
      aria-selected={props.active}
      onClick={props.onClick}
    >
      <b>{props.value}</b>
      <span>{props.label}</span>
    </button>
  )
}

const DETAIL_CONFIG_GROUPS = [
  {
    title: "内容范围",
    hint: "控制当前工作项、父项、关联项、子项的正文和评论是否拉取、展示。",
    keys: [
      ["includeCurrentContent", "当前工作项内容"],
      ["includeCurrentComments", "当前工作项评论"],
      ["includeParentContent", "父项内容"],
      ["includeParentComments", "父项评论"],
      ["includeLinkedContent", "关联项内容"],
      ["includeLinkedComments", "关联项评论"],
      ["includeChildContent", "子项内容"],
      ["includeChildComments", "子项评论"],
    ],
  },
  {
    title: "资源与记录",
    hint: "控制附件、关系、变更记录、飞书外链内容是否参与展示。",
    keys: [
      ["includeAttachments", "附件"],
      ["includeActivities", "变更记录"],
      ["includeRelations", "关联关系"],
      ["includeExternalLinks", "飞书外链内容"],
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string
  hint: string
  keys: ReadonlyArray<readonly [keyof WorkbenchDetailConfig, string]>
}>

type StatusEntry = { slot: true } | { slot: false; name: string }

const STATUS_SLOT: StatusEntry = { slot: true }

// 云效状态配置：两列卡片按行排（左右左右），拖动即调整 Tab 顺序；弹窗里改的是草稿，保存才生效。
function StatusConfigDialog(props: { controller: Controller }) {
  const dialog = useDialog()
  const [mode, setMode] = createSignal(props.controller.statusMode())
  const [picked, setPicked] = createSignal(new Set(props.controller.selectedStatuses()))
  const [order, setOrder] = createSignal(props.controller.statuses().map((status) => status.name))
  const [dragging, setDragging] = createSignal<string>()
  const [dropAt, setDropAt] = createSignal<number>()

  let grid: HTMLDivElement | undefined
  let startScroll = 0
  let startRects: { top: number; bottom: number; left: number; right: number }[] = []

  // 条目对象按状态名复用：拖拽中插入占位只新增节点，不会重建卡片，否则原生拖拽会被打断。
  const entriesByName = new Map<string, StatusEntry>()

  const entryFor = (name: string) => {
    const cached = entriesByName.get(name)

    if (cached) return cached

    const entry: StatusEntry = { slot: false, name }
    entriesByName.set(name, entry)

    return entry
  }

  const known = createMemo(() => new Map(props.controller.statuses().map((status) => [status.name, status])))

  // 顺序按本地草稿排；云效新出现的状态追加到末尾，避免漏项。
  const rows = createMemo(() => {
    const map = known()
    const listed = new Set(order())
    const list = order().flatMap((name) => map.get(name) ?? [])

    for (const status of props.controller.statuses()) if (!listed.has(status.name)) list.push(status)

    return list
  })

  const checkedCount = createMemo(() => [...picked()].filter((name) => known().has(name)).length)

  const toggle = (name: string) => {
    const next = new Set(picked())

    if (next.has(name)) next.delete(name)
    else next.add(name)

    setPicked(next)
  }

  const start = (name: string, event: DragEvent) => {
    setDragging(name)
    setDropAt(undefined)

    startScroll = grid?.scrollTop ?? 0
    startRects = [...(grid?.querySelectorAll<HTMLElement>(".workbench-state-card") ?? [])].map((card) => {
      const rect = card.getBoundingClientRect()

      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    })

    event.dataTransfer?.setData("text/plain", name)

    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  // 用拖拽开始时的卡片矩形算落点：插入占位后卡片会位移，实时测矩形会让落点来回跳。
  const hover = (event: DragEvent) => {
    const delta = (grid?.scrollTop ?? 0) - startScroll
    let at = startRects.length

    for (const [index, rect] of startRects.entries()) {
      if (event.clientY < rect.top - delta) {
        at = index
        break
      }

      if (event.clientY <= rect.bottom - delta) {
        at = event.clientX < (rect.left + rect.right) / 2 ? index : index + 1
        break
      }
    }

    if (dropAt() !== at) setDropAt(at)
  }

  const drop = () => {
    const from = dragging()
    const at = dropAt()

    setDragging(undefined)
    setDropAt(undefined)

    if (!from || at === undefined) return

    const names = rows().map((status) => status.name)
    const index = names.indexOf(from)
    const target = at > index ? at - 1 : at

    if (index < 0 || target === index) return

    const next = names.filter((name) => name !== from)
    next.splice(target, 0, from)
    setOrder(next)
  }

  // 拖动时在落点插入一张虚线占位卡，直接看出会放在哪一格。
  const entries = createMemo(() => {
    const list = rows().map((status) => entryFor(status.name))
    const at = dropAt()

    if (!dragging() || at === undefined) return list

    const next = [...list]
    next.splice(Math.min(at, next.length), 0, STATUS_SLOT)

    return next
  })

  const save = () => {
    props.controller.applyStatusConfig({ mode: mode(), statuses: [...picked()], order: order() })
    dialog.close()
  }

  return (
    <Dialog fit containerStyle={{ width: "604px" }} class="workbench-status-dialog">
      <DialogHeader>
        <DialogTitleGroup title="云效状态配置" />
      </DialogHeader>
      <DialogBody>
        <div class="workbench-status-toolbar">
          <div class="workbench-status-mode" role="group" aria-label="状态筛选方式">
            <button
              type="button"
              aria-pressed={mode() === "include"}
              onClick={() => {
                if (mode() === "include") return

                setMode("include")
                setPicked(new Set<string>())
              }}
            >
              包含
            </button>
            <button
              type="button"
              aria-pressed={mode() === "exclude"}
              onClick={() => {
                if (mode() === "exclude") return

                setMode("exclude")
                setPicked(new Set<string>())
              }}
            >
              排除
            </button>
          </div>
          <span class="workbench-status-summary">
            {props.controller.statuses().length} 个状态
            <Show when={checkedCount()}>
              {mode() === "exclude" ? " · 隐藏 " : " · 只显示 "}
              <b>{checkedCount()} 个</b>
            </Show>
          </span>
        </div>
        <div
          class="workbench-status-dropzone"
          onDragOver={(event) => {
            event.preventDefault()

            if (event.dataTransfer) event.dataTransfer.dropEffect = "move"

            hover(event)
          }}
          onDrop={(event) => {
            event.preventDefault()
            drop()
          }}
        >
          <MenuScroll
            class="workbench-status-scroll"
            viewportClass="workbench-status-grid"
            viewportRef={(element) => {
              grid = element
            }}
          >
            <For each={entries()}>
              {(entry) => {
                if (entry.slot) return <div class="workbench-state-slot" aria-hidden="true" />

                const status = () => known().get(entry.name)
                const selected = () => picked().has(entry.name)

                return (
                  <div
                    class="workbench-state-card"
                    data-status-tone={status()?.tone}
                    data-dragging={dragging() === entry.name ? "" : undefined}
                    draggable="true"
                    onDragStart={(event) => start(entry.name, event)}
                    onDragEnd={() => {
                      setDragging(undefined)
                      setDropAt(undefined)
                    }}
                  >
                    <span class="workbench-state-grip" aria-hidden="true">
                      <svg viewBox="0 0 12 12">
                        <circle cx="4" cy="2.6" r="1.05" />
                        <circle cx="8" cy="2.6" r="1.05" />
                        <circle cx="4" cy="6" r="1.05" />
                        <circle cx="8" cy="6" r="1.05" />
                        <circle cx="4" cy="9.4" r="1.05" />
                        <circle cx="8" cy="9.4" r="1.05" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      class="workbench-state-toggle"
                      aria-pressed={selected()}
                      onClick={() => toggle(entry.name)}
                    >
                      <span class="workbench-config-check">
                        <Show when={selected()}>
                          <Icon name="check" size="small" />
                        </Show>
                      </span>
                      <span class="workbench-status-name">{entry.name}</span>
                    </button>
                    <em>{status()?.count ?? 0}</em>
                  </div>
                )
              }}
            </For>
          </MenuScroll>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => setPicked(new Set<string>())}>
          清空勾选
        </Button>
        <span class="workbench-card-grow" />
        <button type="button" class="workbench-dialog-primary" onClick={save}>
          保存配置
        </button>
      </DialogFooter>
    </Dialog>
  )
}

// 云效详情配置：勾选项直接决定 workitems/context 的 analysisConfig。
function DetailConfigDialog(props: { controller: Controller }) {
  const dialog = useDialog()
  const [draft, setDraft] = createSignal<WorkbenchDetailConfig>(props.controller.detailConfig())

  const toggle = (key: keyof WorkbenchDetailConfig) => setDraft((current) => ({ ...current, [key]: !current[key] }))

  const save = () => {
    props.controller.setDetailConfig(draft())
    dialog.close()
  }

  return (
    <Dialog size="normal" fit class="workbench-config-dialog">
      <DialogHeader>
        <DialogTitleGroup title="云效详情配置" description="对所有工作项生效。保存后再打开详情，就按新配置展示。" />
      </DialogHeader>
      <DialogBody>
        <div class="workbench-config-body">
          <For each={DETAIL_CONFIG_GROUPS}>
            {(group) => (
              <section class="workbench-config-group">
                <h3>{group.title}</h3>
                <p>{group.hint}</p>
                <div class="workbench-config-grid">
                  <For each={group.keys}>
                    {([key, label]) => (
                      <label class="workbench-config-option">
                        <input type="checkbox" checked={draft()[key]} onChange={() => toggle(key)} />
                        <span>{label}</span>
                      </label>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => setDraft(DEFAULT_DETAIL_CONFIG)}>
          恢复默认
        </Button>
        <span class="workbench-card-grow" />
        <button type="button" class="workbench-dialog-primary" onClick={save}>
          保存配置
        </button>
      </DialogFooter>
    </Dialog>
  )
}

function Card(props: {
  item: WorkbenchItem
  task?: WorkbenchTask
  runs: WorkbenchRuns
  active: boolean
  onClick: () => void
}) {
  const run = () => props.runs.runFor(props.task)

  const running = () => {
    const active = run()

    return !!active && props.runs.status(active.sessionId) === "running"
  }

  const label = () => {
    if (!props.task) return ""

    if (props.task.stage === "planning" || props.task.stage === "plan_review")
      return running() ? "规划中" : "待确认计划"

    if (props.task.stage === "executing") return running() ? "执行中" : "执行待确认"

    if (props.task.stage === "verifying") return "待验收"

    if (props.task.stage === "done") return "已完成"

    if (props.task.stage === "failed") return "执行失败"

    if (props.task.stage === "cancelled") return "已取消"

    return "查看处理"
  }

  return (
    <div
      class="workbench-card"
      role="button"
      tabindex="0"
      data-category={props.item.category}
      data-status-tone={statusTone(props.item.statusName)}
      aria-current={props.active}
      onClick={props.onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onClick()
      }}
    >
      <span class="workbench-card-top">
        <span class="workbench-type">{CATEGORY[props.item.category]}</span>
        <Serial value={props.item.serial} />
        <span class="workbench-status">{props.item.statusName}</span>
      </span>
      <span class="workbench-card-title">{props.item.title}</span>
      <span class="workbench-card-people">
        <span title={props.item.creatorName}>
          <em>创建人</em>
          {props.item.creatorName ?? "—"}
        </span>
        <span title={props.item.spaceName}>
          <em>项目</em>
          {props.item.spaceName}
        </span>
      </span>
      <span class="workbench-card-foot">
        <Show when={priorityLabel(props.item)}>
          <span class="workbench-priority" data-priority-tone={priorityTone(props.item)}>
            {priorityLabel(props.item)}
          </span>
        </Show>
        <Show when={props.task}>
          <button
            type="button"
            class="workbench-card-run"
            data-state={running() ? "running" : props.task!.stage === "done" ? "done" : "idle"}
            title="打开处理会话"
            onClick={(event) => {
              event.stopPropagation()
              props.runs.open(run())
            }}
          >
            <i />
            {label()}
          </button>
        </Show>
        <span class="workbench-card-grow" />
        <span>{relative(props.item.updatedAt)}</span>
      </span>
    </div>
  )
}

// 主进程还没升级到返回 descriptionHtml 时（旧版本），在渲染侧按同一套规则解析原始富文本。
function descriptionHtml(detail: { description?: string; descriptionHtml?: string }) {
  if (detail.descriptionHtml) return detail.descriptionHtml

  return parseRichText(detail.description).html
}

// 云效正文经常只有一个空段落，这种就不必显示"描述"分区。
function hasContent(html: string) {
  return (
    /<img\b/i.test(html) ||
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, "")
      .trim().length > 0
  )
}

// 正文复用：主工作项、父项、子项、关联项都走同一套排版与图片放大。
function RichText(props: { html: string; onImage: (src: string) => void }) {
  return (
    <div
      class="workbench-prose"
      onClick={(event) => {
        if (event.target instanceof HTMLImageElement) props.onImage(event.target.currentSrc || event.target.src)
      }}
      innerHTML={safeRichText(props.html)}
    />
  )
}

function CommentList(props: { comments: readonly WorkbenchComment[] }) {
  return (
    <div class="workbench-comments">
      <For each={props.comments}>
        {(comment) => (
          <article class="workbench-comment">
            <span class="workbench-avatar" aria-hidden="true">
              {comment.author.slice(0, 1)}
            </span>
            <div class="workbench-comment-body">
              <header>
                <strong>{comment.author}</strong>
                <span>{absolute(comment.created)}</span>
              </header>
              <RichText html={comment.contentHtml || parseRichText(comment.content).html} onImage={() => undefined} />
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

// 父项/子项/关联项：一张卡片带自己的类型、状态、基础信息、正文和评论。
function ContextBlock(props: { title: string; context: WorkbenchSubItem; onImage: (src: string) => void }) {
  const item = () => props.context.item

  return (
    <section class="workbench-block" data-category={item().category} data-status-tone={statusTone(item().statusName)}>
      <h3>{props.title}</h3>
      <div class="workbench-context-head">
        <span class="workbench-type">{CATEGORY[item().category]}</span>
        <Serial value={item().serial} />
        <span class="workbench-status">{item().statusName}</span>
      </div>
      <div class="workbench-context-title">{item().title}</div>
      <div class="workbench-props">
        <Meta label="负责人" value={item().assigneeName} />
        <Meta label="优先级">
          <Show when={priorityLabel(item())} fallback={<strong>—</strong>}>
            <span class="workbench-priority" data-priority-tone={priorityTone(item())}>
              {priorityLabel(item())}
            </span>
          </Show>
        </Meta>
      </div>
      <Show when={hasContent(descriptionHtml(props.context))}>
        <RichText html={descriptionHtml(props.context)} onImage={props.onImage} />
      </Show>
      <Show when={props.context.comments.length}>
        <h4 class="workbench-context-sub">评论 · {props.context.comments.length}</h4>
        <CommentList comments={props.context.comments} />
      </Show>
    </section>
  )
}

const DOC_TABS = [
  ["plan", "方案"],
  ["tasks", "任务"],
  ["testPlan", "测试"],
  ["acceptance", "验收"],
  ["review", "审查"],
  ["log", "记录"],
] as const

type DocTab = (typeof DOC_TABS)[number][0]

function Detail(props: { detail: WorkbenchDetail; runs: WorkbenchRuns; onClose: () => void }) {
  const item = () => props.detail.item
  // 正文图片先按缩略图并排展示，点开再看原图（云效正文里的图往往是一大串截图）。
  const [preview, setPreview] = createSignal<string>()
  const [picked, setPicked] = createSignal<string>()
  const [confirm, setConfirm] = createSignal<WorkbenchPreflight>()
  const [docs, setDocs] = createSignal<WorkbenchTaskDocs>()
  const [docTab, setDocTab] = createSignal<DocTab>("plan")

  const target = () => {
    const chosen = picked()
    const all = props.runs.targets()

    return (chosen ? all.find((project) => project.directory === chosen) : undefined) ?? props.runs.target()
  }

  const task = () => props.runs.taskFor(item().id)
  const run = () => props.runs.runFor(task())

  const running = () => {
    const active = run()

    return !!active && props.runs.status(active.sessionId) === "running"
  }

  const stage = () => task()?.stage

  const needsApproval = () => {
    const current = task()

    return !!current && (current.stage === "planning" || current.stage === "plan_review") && !running()
  }

  createEffect(() => {
    const current = task()

    if (!current) return setDocs(undefined)

    props.runs
      .docs(current)
      .then((next) => setDocs(next))
      .catch(() => setDocs(undefined))
  })

  const begin = async () => {
    const current = target()

    if (!current) return

    const check = await props.runs.preflight(current.directory).catch(() => undefined)

    if (!check) return notify("无法读取工作区状态")

    if (!check.repo) return notify(`无法使用该目录：${check.error ?? "不是 git 仓库"}`)

    if (check.dirty) return setConfirm(check)

    props.runs.start({ item: item(), detail: props.detail, directory: current.directory }).catch(() => undefined)
  }

  const proceed = () => {
    const current = target()

    setConfirm(undefined)

    if (!current) return

    props.runs.start({ item: item(), detail: props.detail, directory: current.directory }).catch(() => undefined)
  }

  const approve = () => {
    const current = task()

    if (current) props.runs.approve(current).catch(() => undefined)
  }

  const replan = () => {
    const current = task()

    if (current) props.runs.replan({ item: item(), detail: props.detail, task: current }).catch(() => undefined)
  }

  const advance = (next: "verifying" | "done") => {
    const current = task()

    if (current) props.runs.advance(current, next).catch(() => undefined)
  }

  const docText = () => {
    const value = docs()

    return value ? value[docTab()] || "（暂无内容）" : ""
  }

  const pick = async () => {
    const directory = await props.runs.pickTarget()

    if (directory) setPicked(directory)
  }

  return (
    <div
      class="workbench-detail-inner"
      data-category={item().category}
      data-status-tone={statusTone(item().statusName)}
    >
      <header class="workbench-detail-head">
        <div class="workbench-detail-top">
          <span class="workbench-card-grow" />
          <IconButton
            icon={<Icon name="xmark-small" />}
            variant="ghost-muted"
            size="small"
            aria-label="关闭详情"
            onClick={props.onClose}
          />
        </div>
        <h2>{item().title}</h2>
        <div class="workbench-detail-sub">
          <Serial value={item().serial} />
          <span>·</span>
          <span>{item().spaceName}</span>
          <span>·</span>
          <span>{item().statusName}</span>
          <span>·</span>
          <span>{relative(item().updatedAt)}更新</span>
        </div>
      </header>

      <div class="workbench-detail-body">
        <section class="workbench-block" data-kind="self">
          <h3>当前工作项</h3>
          <div class="workbench-props">
            <Meta label="类型">
              <span class="workbench-type">{item().categoryName}</span>
            </Meta>
            <Meta label="优先级">
              <Show when={priorityLabel(item())} fallback={<strong>—</strong>}>
                <span class="workbench-priority" data-priority-tone={priorityTone(item())}>
                  {priorityLabel(item())}
                </span>
              </Show>
            </Meta>
            <Meta label="创建人" value={item().creatorName} />
            <Meta label="负责人" value={item().assigneeName} />
            <Meta label="所属项目" value={item().spaceName} />
            <Meta label="更新时间" value={absolute(item().updatedAt)} />
          </div>
        </section>

        <Show when={task()}>
          <section class="workbench-block" data-kind="docs">
            <div class="workbench-docs-head">
              <h3>规划文档</h3>
              <div class="workbench-docs-tabs" role="tablist" aria-label="规划文档">
                <For each={DOC_TABS}>
                  {([key, label]) => (
                    <button type="button" role="tab" aria-selected={docTab() === key} onClick={() => setDocTab(key)}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show when={docs()} fallback={<p class="workbench-ai-hint">正在读取规划文档…</p>}>
              <div class="workbench-docs-body">
                <MarkdownProvider codeBlocks={false}>
                  <Markdown text={docText()} />
                </MarkdownProvider>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={hasContent(descriptionHtml(props.detail))}>
          <section class="workbench-block">
            <h3>描述</h3>
            <RichText html={descriptionHtml(props.detail)} onImage={setPreview} />
          </section>
        </Show>

        <Show when={props.detail.parent}>
          {(parent) => <ContextBlock title="父工作项" context={parent()} onImage={setPreview} />}
        </Show>

        <For each={props.detail.children}>
          {(child) => <ContextBlock title="子工作项" context={child} onImage={setPreview} />}
        </For>

        <For each={props.detail.linked}>
          {(linked) => <ContextBlock title="关联项" context={linked} onImage={setPreview} />}
        </For>

        <Show when={!props.detail.linked.length && props.detail.relations.length}>
          <section class="workbench-block">
            <h3>关联项</h3>
            <div class="workbench-relations">
              <For each={props.detail.relations}>
                {(relation) => (
                  <div>
                    <code>{relation.serial}</code>
                    <span>{relation.title}</span>
                    <em>{relation.statusName}</em>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.detail.attachments.length}>
          <section class="workbench-block">
            <h3>附件 · {props.detail.attachments.length}</h3>
            <div class="workbench-attachments">
              <For each={props.detail.attachments}>
                {(attachment) => (
                  <Show
                    when={attachment.url}
                    fallback={
                      <span>
                        <Icon name="file-document" size="small" />
                        {attachment.name}
                      </span>
                    }
                  >
                    {(url) => (
                      <a href={url()} target="_blank" rel="noreferrer">
                        <Icon name="file-document" size="small" />
                        {attachment.name}
                      </a>
                    )}
                  </Show>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.detail.activities.length}>
          <section class="workbench-block">
            <h3>变更记录 · {props.detail.activities.length}</h3>
            <div class="workbench-activities">
              <For each={props.detail.activities}>
                {(activity) => (
                  <div>
                    <i />
                    <strong>{activity.author}</strong>
                    <span>{activity.action}</span>
                    <em>{absolute(activity.created)}</em>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.detail.comments.length}>
          <section class="workbench-block">
            <h3>评论 · {props.detail.comments.length}</h3>
            <CommentList comments={props.detail.comments} />
          </section>
        </Show>
      </div>

      <Show when={preview()}>
        {(src) => (
          <div class="workbench-lightbox" onClick={() => setPreview(undefined)}>
            <img src={src()} alt="" />
            <IconButton
              class="workbench-lightbox-close"
              icon={<Icon name="xmark-small" />}
              variant="ghost-muted"
              size="small"
              aria-label="关闭图片"
              onClick={() => setPreview(undefined)}
            />
          </div>
        )}
      </Show>

      <footer class="workbench-detail-foot">
        <button
          type="button"
          class="workbench-detail-target"
          title={target()?.directory ?? "选择 AI 处理的项目目录"}
          onClick={() => void pick()}
        >
          <Icon name="folder-add-left" size="small" />
          <span>{target()?.name ?? "选择项目目录"}</span>
          <Icon name="chevron-down" size="small" />
        </button>
        <Show
          when={task()}
          fallback={
            <button
              type="button"
              class="workbench-detail-primary"
              disabled={!target() || props.runs.busy(item().id)}
              onClick={() => void begin()}
            >
              <Show
                when={props.runs.busy(item().id)}
                fallback={
                  <>
                    开始分析
                    <Icon name="arrow-right" size="small" />
                  </>
                }
              >
                <Loader class="size-3" />
                正在创建…
              </Show>
            </button>
          }
        >
          <Switch>
            <Match when={needsApproval()}>
              <button type="button" class="workbench-detail-primary" onClick={() => void approve()}>
                同意计划并执行
                <Icon name="arrow-right" size="small" />
              </button>
              <button type="button" class="workbench-detail-secondary" onClick={() => void replan()}>
                重新规划
              </button>
              <button type="button" class="workbench-detail-secondary" onClick={() => props.runs.open(run())}>
                查看会话
              </button>
            </Match>
            <Match when={stage() === "executing"}>
              <button type="button" class="workbench-detail-primary" onClick={() => advance("verifying")}>
                执行完成
                <Icon name="arrow-right" size="small" />
              </button>
              <button type="button" class="workbench-detail-secondary" onClick={() => props.runs.open(run())}>
                查看会话
              </button>
            </Match>
            <Match when={stage() === "verifying"}>
              <button type="button" class="workbench-detail-primary" onClick={() => advance("done")}>
                验收通过
                <Icon name="arrow-right" size="small" />
              </button>
              <button type="button" class="workbench-detail-secondary" onClick={() => props.runs.open(run())}>
                继续处理
              </button>
            </Match>
            <Match when={stage() === "failed" || stage() === "cancelled"}>
              <button type="button" class="workbench-detail-primary" onClick={() => void replan()}>
                重新规划
                <Icon name="arrow-right" size="small" />
              </button>
            </Match>
            <Match when={true}>
              <button type="button" class="workbench-detail-secondary" onClick={() => props.runs.open(run())}>
                查看处理会话
              </button>
            </Match>
          </Switch>
        </Show>
        <span class="workbench-card-grow" />
        <Show when={item().url}>
          {(url) => (
            <a href={url()} target="_blank" rel="noreferrer">
              打开云效
              <Icon name="arrow-up-right" size="small" />
            </a>
          )}
        </Show>
      </footer>

      <Show when={confirm()}>
        {(check) => (
          <div class="workbench-confirm-backdrop" onClick={() => setConfirm(undefined)}>
            <div
              class="workbench-confirm"
              role="dialog"
              aria-label="确认工作区改动"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>当前目录有未提交改动</h3>
              <p>
                {check().branch ?? "未知分支"} · {check().modified} 个已修改 · {check().untracked} 个未跟踪
              </p>
              <ul>
                <For each={check().files}>{(file) => <li>{file}</li>}</For>
              </ul>
              <p>AI 会在同一工作区继续修改，可能与这些改动混在一起。已自动记一份 checkpoint。</p>
              <div class="workbench-confirm-actions">
                <button type="button" onClick={() => setConfirm(undefined)}>
                  取消
                </button>
                <button type="button" class="workbench-confirm-primary" onClick={proceed}>
                  仍然继续
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

function DetailPlaceholder(props: { item: WorkbenchItem; onClose: () => void }) {
  return (
    <div
      class="workbench-detail-inner"
      data-category={props.item.category}
      data-status-tone={statusTone(props.item.statusName)}
    >
      <header class="workbench-detail-head">
        <div class="workbench-detail-top">
          <code>{props.item.serial}</code>
          <span class="workbench-card-grow" />
          <IconButton
            icon={<Icon name="xmark-small" />}
            variant="ghost-muted"
            size="small"
            aria-label="关闭详情"
            onClick={props.onClose}
          />
        </div>
        <h2>{props.item.title}</h2>
      </header>
      <div class="workbench-detail-loading">
        <Loader class="size-3.5" />
        <span>正在读取详情…</span>
      </div>
    </div>
  )
}

function Meta(props: { label: string; value?: string; children?: JSX.Element }) {
  return (
    <div class="workbench-prop">
      <span>{props.label}</span>
      <Show when={props.children} fallback={<strong>{props.value ?? "—"}</strong>}>
        {props.children}
      </Show>
    </div>
  )
}

function WorkbenchSkeleton() {
  return (
    <div class="workbench-skeleton" aria-busy="true" aria-live="polite">
      <div class="workbench-skeleton-bar">
        <Loader class="size-3.5" />
        <span>正在读取云效工作项…</span>
      </div>
      <div class="workbench-skeleton-hero">
        <div class="workbench-skeleton-brief">
          <span class="workbench-skeleton-line" data-w="34%" />
          <span class="workbench-skeleton-line" data-w="62%" />
          <span class="workbench-skeleton-line" data-w="88%" />
          <span class="workbench-skeleton-line" data-w="42%" />
        </div>
        <div class="workbench-skeleton-focus">
          <span class="workbench-skeleton-line" data-w="28%" />
          <span class="workbench-skeleton-line" data-w="76%" />
          <span class="workbench-skeleton-line" data-w="58%" />
        </div>
        <div class="workbench-skeleton-ring" />
      </div>
      <div class="workbench-skeleton-tabs">
        <For each={SKELETON_TABS}>
          {(width) => <span class="workbench-skeleton-pill" style={{ width: `${width}px` }} />}
        </For>
      </div>
      <div class="workbench-skeleton-grid">
        <For each={SKELETON_CARDS}>
          {() => (
            <div class="workbench-skeleton-card">
              <span class="workbench-skeleton-line" data-w="34%" />
              <span class="workbench-skeleton-line" data-w="88%" />
              <span class="workbench-skeleton-line" data-w="64%" />
              <span class="workbench-skeleton-line" data-w="42%" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function WorkbenchEmpty(props: { title: string; detail: string }) {
  return (
    <div class="workbench-empty">
      <Icon name="window-analytics" size="large" />
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  )
}
