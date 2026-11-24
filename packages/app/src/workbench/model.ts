import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Option, Schema } from "effect"
import {
  DEFAULT_DETAIL_CONFIG,
  type WorkbenchBridge,
  type WorkbenchDetail,
  type WorkbenchDetailConfig,
  type WorkbenchItem,
  type WorkbenchSnapshot,
} from "./types"
import { errorMessage } from "@/shell/layout/helpers"
import { statusTone, type StatusTone } from "./status-tone"

const POLL_MS = 5 * 60 * 1000

const STATUS_PREFERENCES_KEY = "workbench-status-preferences-v2"

// v1 只存了“隐藏了哪些状态”，读到时迁移成排除模式。
const LEGACY_STATUS_PREFERENCES_KEY = "workbench-status-preferences-v1"

const DETAIL_CONFIG_KEY = "workbench-detail-config-v1"

// include：只显示勾选的状态；exclude：显示除勾选之外的状态。
export type StatusFilterMode = "include" | "exclude"

type StatusPreferences = {
  mode: StatusFilterMode
  statuses: readonly string[]
  // 用户拖拽出来的状态顺序；空数组表示跟随云效工作流顺序。
  order: readonly string[]
}

const statusPreferencesSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literals(["include", "exclude"])),
  statuses: Schema.optional(Schema.Array(Schema.String)),
  order: Schema.optional(Schema.Array(Schema.String)),
})

const legacyStatusPreferencesSchema = Schema.Struct({
  hidden: Schema.optional(Schema.Array(Schema.String)),
  sort: Schema.optional(Schema.Literals(["workflow", "count", "name"])),
})

const priorityRank = (value?: string) => {
  const match = value?.match(/^P(\d)$/i)

  return match ? Number(match[1]) : 9
}

// 已开工的状态色组：这些工作项出现在「继续推进」泳道，也是今日聚焦的优先候选。
const IN_FLIGHT_TONES = new Set<StatusTone>(["doing", "testing-active", "developed", "testing", "acceptance"])

// 已结束的状态：列表里可以查，但不参与聚焦、推进和拍板统计。
const CLOSED_TONES = new Set<StatusTone>(["done", "closed", "rejected"])

// 默认排除已完成类的状态：日常视图不该被几百条历史工单淹没，需要时在配置里勾回来。
const DEFAULT_EXCLUDED_STATUSES = ["已完成", "已解决", "已通过", "已关闭", "已取消", "已拒绝", "无法复现"]

const detailConfigSchema = Schema.Struct({
  includeCurrentContent: Schema.optional(Schema.Boolean),
  includeCurrentComments: Schema.optional(Schema.Boolean),
  includeParentContent: Schema.optional(Schema.Boolean),
  includeParentComments: Schema.optional(Schema.Boolean),
  includeLinkedContent: Schema.optional(Schema.Boolean),
  includeLinkedComments: Schema.optional(Schema.Boolean),
  includeChildContent: Schema.optional(Schema.Boolean),
  includeChildComments: Schema.optional(Schema.Boolean),
  includeAttachments: Schema.optional(Schema.Boolean),
  includeRelations: Schema.optional(Schema.Boolean),
  includeActivities: Schema.optional(Schema.Boolean),
  includeExternalLinks: Schema.optional(Schema.Boolean),
})

function readDetailConfig(): WorkbenchDetailConfig {
  try {
    const raw = globalThis.localStorage?.getItem(DETAIL_CONFIG_KEY)

    if (!raw) return DEFAULT_DETAIL_CONFIG

    const value = Schema.decodeUnknownOption(Schema.fromJsonString(detailConfigSchema))(raw)

    if (Option.isNone(value)) return DEFAULT_DETAIL_CONFIG

    // 旧配置缺字段时逐个回落到默认值，保证 12 个开关都是布尔。
    return {
      includeCurrentContent: value.value.includeCurrentContent ?? DEFAULT_DETAIL_CONFIG.includeCurrentContent,
      includeCurrentComments: value.value.includeCurrentComments ?? DEFAULT_DETAIL_CONFIG.includeCurrentComments,
      includeParentContent: value.value.includeParentContent ?? DEFAULT_DETAIL_CONFIG.includeParentContent,
      includeParentComments: value.value.includeParentComments ?? DEFAULT_DETAIL_CONFIG.includeParentComments,
      includeLinkedContent: value.value.includeLinkedContent ?? DEFAULT_DETAIL_CONFIG.includeLinkedContent,
      includeLinkedComments: value.value.includeLinkedComments ?? DEFAULT_DETAIL_CONFIG.includeLinkedComments,
      includeChildContent: value.value.includeChildContent ?? DEFAULT_DETAIL_CONFIG.includeChildContent,
      includeChildComments: value.value.includeChildComments ?? DEFAULT_DETAIL_CONFIG.includeChildComments,
      includeAttachments: value.value.includeAttachments ?? DEFAULT_DETAIL_CONFIG.includeAttachments,
      includeRelations: value.value.includeRelations ?? DEFAULT_DETAIL_CONFIG.includeRelations,
      includeActivities: value.value.includeActivities ?? DEFAULT_DETAIL_CONFIG.includeActivities,
      includeExternalLinks: value.value.includeExternalLinks ?? DEFAULT_DETAIL_CONFIG.includeExternalLinks,
    }
  } catch {
    return DEFAULT_DETAIL_CONFIG
  }
}

function readStatusPreferences(): StatusPreferences {
  try {
    const storage = globalThis.localStorage
    const raw = storage?.getItem(STATUS_PREFERENCES_KEY)

    if (!raw) {
      const legacy = storage?.getItem(LEGACY_STATUS_PREFERENCES_KEY)

      if (!legacy) return { mode: "exclude", statuses: DEFAULT_EXCLUDED_STATUSES, order: [] }

      const value = Schema.decodeUnknownOption(Schema.fromJsonString(legacyStatusPreferencesSchema))(legacy)

      if (Option.isNone(value)) return { mode: "exclude", statuses: DEFAULT_EXCLUDED_STATUSES, order: [] }

      // 旧版没隐藏过任何状态，视为“没配置过”，用默认排除列表。
      const hidden = value.value.hidden ?? []

      return {
        mode: "exclude",
        statuses: hidden.length ? hidden : DEFAULT_EXCLUDED_STATUSES,
        order: [],
      }
    }

    const value = Schema.decodeUnknownOption(Schema.fromJsonString(statusPreferencesSchema))(raw)

    if (Option.isNone(value)) return { mode: "exclude", statuses: [], order: [] }

    return {
      mode: value.value.mode ?? "exclude",
      statuses: value.value.statuses ?? [],
      order: value.value.order ?? [],
    }
  } catch {
    return { mode: "exclude", statuses: [], order: [] }
  }
}

export function createWorkbenchController(bridge: () => WorkbenchBridge | undefined) {
  const preferences = readStatusPreferences()
  const [snapshot, setSnapshot] = createSignal<WorkbenchSnapshot>()
  const [loading, setLoading] = createSignal(false)
  const [detail, setDetail] = createSignal<WorkbenchDetail>()
  const [detailLoading, setDetailLoading] = createSignal(false)
  const [selected, setSelected] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal("all")
  const [statusMode, setStatusMode] = createSignal<StatusFilterMode>(preferences.mode)
  const [selectedStatuses, setSelectedStatuses] = createSignal(new Set(preferences.statuses))
  const [statusOrderPreference, setStatusOrderPreference] = createSignal<readonly string[]>(preferences.order)
  const [detailConfig, setDetailConfigSignal] = createSignal<WorkbenchDetailConfig>(readDetailConfig())

  let inflight: Promise<WorkbenchSnapshot | undefined> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const load = (force: boolean) => {
    const api = bridge()

    if (!api) return Promise.resolve(undefined)

    // Two triggers (mount + manual refresh + timer) share one request.
    if (inflight) return inflight

    setLoading(true)
    inflight = api
      .state(force)
      .then((next) => {
        setSnapshot(next)

        return next
      })
      .catch((cause) => {
        setSnapshot((previous) =>
          previous ? { ...previous, error: errorMessage(cause, "工作台请求失败") } : undefined,
        )

        return undefined
      })
      .finally(() => {
        setLoading(false)
        inflight = undefined
      })

    return inflight
  }

  const schedule = () => {
    timer = setTimeout(() => {
      if (document.visibilityState === "hidden") return schedule()
      void load(true).then(schedule)
    }, POLL_MS)
  }

  const onVisibility = () => {
    if (document.visibilityState !== "visible") return
    const last = snapshot()?.fetchedAt ?? 0

    if (Date.now() - last > POLL_MS) void load(true)
  }

  onMount(() => {
    void load(false)
    schedule()
    document.addEventListener("visibilitychange", onVisibility)
  })

  onCleanup(() => {
    if (timer) clearTimeout(timer)
    document.removeEventListener("visibilitychange", onVisibility)
  })

  createEffect(() => {
    if (!globalThis.localStorage) return

    globalThis.localStorage.setItem(DETAIL_CONFIG_KEY, JSON.stringify(detailConfig()))
  })

  // 配置是全局的，保存后只是记下来；下次打开详情时按新配置拉取。
  const setDetailConfig = (next: WorkbenchDetailConfig) => setDetailConfigSignal(next)

  createEffect(() => {
    if (!globalThis.localStorage) return

    globalThis.localStorage.setItem(
      STATUS_PREFERENCES_KEY,
      JSON.stringify({
        mode: statusMode(),
        statuses: [...selectedStatuses()],
        order: [...statusOrderPreference()],
      } satisfies StatusPreferences),
    )
  })

  // 状态顺序：先按用户拖出来的顺序，剩下的跟随云效工作流顺序。
  const statusOrder = createMemo(() => {
    const order = new Map<string, number>()

    const push = (name: string) => {
      if (!order.has(name)) order.set(name, order.size)
    }

    for (const name of statusOrderPreference()) push(name)

    for (const name of snapshot()?.statuses ?? []) push(name)

    for (const item of snapshot()?.items ?? []) push(item.statusName)

    return order
  })

  // 状态全集来自云效工作流状态清单（filter-options），没出现的状态也留在配置里可以管理。
  const statuses = createMemo(() => {
    const counts = new Map<string, number>()
    const order = statusOrder()

    for (const name of order.keys()) counts.set(name, 0)

    for (const item of snapshot()?.items ?? []) counts.set(item.statusName, (counts.get(item.statusName) ?? 0) + 1)

    const rank = (name: string) => order.get(name) ?? order.size
    const values = [...counts].map(([name, count]) => ({ name, count, tone: statusTone(name) }))

    return values.sort((left, right) => rank(left.name) - rank(right.name))
  })

  // 勾选语义：include 只留勾选的；exclude 去掉勾选的；没勾选任何状态视为不过滤。
  const passesStatus = (name: string) => {
    const selected = selectedStatuses()

    if (!selected.size) return true

    return statusMode() === "include" ? selected.has(name) : !selected.has(name)
  }

  // 顶部 Tab 只显示当前有工作项、且没被状态配置排除的状态。
  const tabStatuses = createMemo(() => statuses().filter((status) => status.count > 0 && passesStatus(status.name)))

  const visibleStatuses = createMemo(() => tabStatuses())

  createEffect(() => {
    const current = filter()

    if (current !== "all" && !visibleStatuses().some((status) => status.name === current)) setFilter("all")
  })

  // 状态配置决定任务列表：被排除的状态不进入任何视图。
  const scoped = createMemo(() => {
    const order = statusOrder()
    const rank = (name: string) => order.get(name) ?? order.size

    return [...(snapshot()?.items ?? [])]
      .filter((item) => passesStatus(item.statusName))
      .sort(
        (left, right) =>
          rank(left.statusName) - rank(right.statusName) ||
          priorityRank(left.priority) - priorityRank(right.priority) ||
          new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime(),
      )
  })

  // 已结束的状态仍然可以在列表里查到，但不该再占“今日聚焦 / 继续推进 / 需要拍板”。
  const active = createMemo(() => scoped().filter((item) => !CLOSED_TONES.has(statusTone(item.statusName))))

  // 在途：已经开工、需要接着推进的工作项，按优先级排，同级看最近更新。
  const inFlight = createMemo(() =>
    active()
      .filter((item) => IN_FLIGHT_TONES.has(statusTone(item.statusName)))
      .sort(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime(),
      ),
  )

  // 今日聚焦：可开工项里先看已开工的，再按优先级，最后挑最久没动的，避免高优任务一直沉底。
  const focus = createMemo<WorkbenchItem | undefined>(() => {
    const inFlightIds = new Set(inFlight().map((item) => item.id))

    return active()
      .filter((item) => item.readiness === "ready")
      .sort(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          Number(inFlightIds.has(right.id)) - Number(inFlightIds.has(left.id)) ||
          new Date(left.updatedAt ?? 0).getTime() - new Date(right.updatedAt ?? 0).getTime(),
      )[0]
  })

  // 需要人拍板：阻塞优先于待澄清，同级按优先级、再看谁放得更久。
  const decisions = createMemo(() =>
    active()
      .filter((item) => item.readiness !== "ready")
      .sort(
        (left, right) =>
          Number(right.readiness === "blocked") - Number(left.readiness === "blocked") ||
          priorityRank(left.priority) - priorityRank(right.priority) ||
          new Date(left.updatedAt ?? 0).getTime() - new Date(right.updatedAt ?? 0).getTime(),
      ),
  )

  // 健康度只统计当前可见状态，和列表口径保持一致。
  const readiness = createMemo(() => {
    const counts = { ready: 0, clarify: 0, blocked: 0 }

    for (const item of active()) counts[item.readiness] += 1

    return counts
  })

  const matchesQuery = (title: string, serial: string, spaceName: string, text: string) => {
    if (!text) return true

    return (
      title.toLowerCase().includes(text) ||
      serial.toLowerCase().includes(text) ||
      spaceName.toLowerCase().includes(text)
    )
  }

  const visibleTotal = createMemo(() => {
    const text = query().trim().toLowerCase()

    return scoped().filter((item) => matchesQuery(item.title, item.serial, item.spaceName, text)).length
  })

  const items = createMemo(() => {
    const status = filter()
    const text = query().trim().toLowerCase()

    return scoped().filter((item) => {
      if (status !== "all" && item.statusName !== status) return false

      return matchesQuery(item.title, item.serial, item.spaceName, text)
    })
  })

  // 详情每次都重新取（元数据要新）；大图由主进程按 URL 缓存，重开不会重新下载图片。
  const loadDetail = (id: string, force: boolean) => {
    const api = bridge()

    if (!api) return

    setDetailLoading(true)
    void api
      .item(id, detailConfig(), force)
      .then((next) => {
        // A fast second click must not be overwritten by the slower first response.
        if (selected() === id) setDetail(next)
      })
      .catch(() => undefined)
      .finally(() => setDetailLoading(false))
  }

  const open = (item: WorkbenchItem) => {
    setSelected(item.id)
    setDetail(undefined)
    loadDetail(item.id, false)
  }

  // 抽屉右上角的刷新：跳过图片缓存，连图片也重新下载。
  const refreshDetail = () => {
    const id = selected()

    if (id) loadDetail(id, true)
  }

  const close = () => {
    setSelected(undefined)
    setDetail(undefined)
  }

  const saveToken = async (token: string) => {
    const api = bridge()

    if (!api) return

    setLoading(true)

    try {
      setSnapshot(await api.setToken(token))
    } finally {
      setLoading(false)
    }
  }

  // 弹窗里改的是草稿，点保存才落到这里，列表和 Tab 随之更新。
  const applyStatusConfig = (next: {
    mode: StatusFilterMode
    statuses: readonly string[]
    order: readonly string[]
  }) => {
    setStatusMode(next.mode)
    setSelectedStatuses(new Set(next.statuses))
    setStatusOrderPreference(next.order)
  }

  // 点已选中的 Tab 再点一次就回到“全部”。
  const toggleFilter = (name: string) => setFilter(filter() === name ? "all" : name)

  return {
    snapshot,
    loading,
    items,
    query,
    setQuery,
    filter,
    setFilter,
    statuses,
    visibleStatuses,
    visibleTotal,
    statusMode,
    selectedStatuses,
    applyStatusConfig,
    toggleFilter,
    selected,
    open,
    close,
    detail,
    detailLoading,
    refreshDetail,
    detailConfig,
    setDetailConfig,
    refresh: () => load(true),
    saveToken,
    inFlight,
    focus,
    decisions,
    readiness,
  }
}
