import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Option, Schema } from "effect"
import type { WorkbenchBridge, WorkbenchDetail, WorkbenchItem, WorkbenchSnapshot } from "./types"
import { errorMessage } from "@/shell/layout/helpers"
import { statusRank, statusTone } from "./status-tone"

const POLL_MS = 5 * 60 * 1000

const STATUS_PREFERENCES_KEY = "workbench-status-preferences-v1"

type StatusSort = "count" | "name"

type StatusPreferences = {
  hidden: readonly string[]
  sort: StatusSort
}

const statusPreferencesSchema = Schema.Struct({
  hidden: Schema.optional(Schema.Array(Schema.String)),
  sort: Schema.optional(Schema.Literals(["count", "name"])),
})

const priorityRank = (value?: string) => {
  const match = value?.match(/^P(\d)$/i)

  return match ? Number(match[1]) : 9
}

function readStatusPreferences(): StatusPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STATUS_PREFERENCES_KEY)

    if (!raw) return { hidden: [], sort: "count" }

    const value = Schema.decodeUnknownOption(Schema.fromJsonString(statusPreferencesSchema))(raw)

    if (Option.isNone(value)) return { hidden: [], sort: "count" }

    return { hidden: value.value.hidden ?? [], sort: value.value.sort ?? "count" }
  } catch {
    return { hidden: [], sort: "count" }
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
  const [hiddenStatuses, setHiddenStatuses] = createSignal(new Set(preferences.hidden))
  const [statusSort, setStatusSort] = createSignal<StatusSort>(preferences.sort)

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

    globalThis.localStorage.setItem(
      STATUS_PREFERENCES_KEY,
      JSON.stringify({ hidden: [...hiddenStatuses()], sort: statusSort() } satisfies StatusPreferences),
    )
  })

  const statuses = createMemo(() => {
    const counts = new Map<string, number>()

    for (const item of snapshot()?.items ?? []) counts.set(item.statusName, (counts.get(item.statusName) ?? 0) + 1)

    const values = [...counts].map(([name, count]) => ({ name, count, tone: statusTone(name) }))

    return values.sort(
      statusSort() === "name"
        ? (left, right) => left.name.localeCompare(right.name, "zh-CN")
        : (left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
    )
  })

  const visibleStatuses = createMemo(() => statuses().filter((status) => !hiddenStatuses().has(status.name)))

  createEffect(() => {
    const current = filter()

    if (current !== "all" && !visibleStatuses().some((status) => status.name === current)) setFilter("all")
  })

  const items = createMemo(() => {
    const all = snapshot()?.items ?? []
    const status = filter()
    const text = query().trim().toLowerCase()

    return [...all]
      .sort(
        (left, right) =>
          statusRank(left.statusName) - statusRank(right.statusName) ||
          priorityRank(left.priority) - priorityRank(right.priority) ||
          new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime(),
      )
      .filter((item) => {
        if (status !== "all" && item.statusName !== status) return false

        if (!text) return true

        return (
          item.title.toLowerCase().includes(text) ||
          item.serial.toLowerCase().includes(text) ||
          item.spaceName.toLowerCase().includes(text)
        )
      })
  })

  const open = (item: WorkbenchItem) => {
    setSelected(item.id)
    setDetail(undefined)

    const api = bridge()

    if (!api) return

    setDetailLoading(true)
    void api
      .item(item.id)
      .then((next) => {
        // A fast second click must not be overwritten by the slower first response.
        if (selected() === item.id) setDetail(next)
      })
      .catch(() => undefined)
      .finally(() => setDetailLoading(false))
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

  const toggleStatus = (name: string) => {
    const next = new Set(hiddenStatuses())

    if (next.has(name)) next.delete(name)
    else next.add(name)
    setHiddenStatuses(next)
  }

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
    hiddenStatuses,
    toggleStatus,
    statusSort,
    setStatusSort,
    selected,
    open,
    close,
    detail,
    detailLoading,
    refresh: () => load(true),
    saveToken,
  }
}
