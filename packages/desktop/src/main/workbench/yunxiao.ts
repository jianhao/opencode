/**
 * Yunxiao reads go through the local frontend-server agent API, which already owns the Projex
 * client, the shared organization and the token fallback. The workbench never talks to Aliyun
 * directly and never writes.
 */

const CATEGORIES = ["Req", "Task", "Bug"] as const
const CONCURRENCY = 4
const TIMEOUT_MS = 15000
const CLOSED_STAGE = "4"
const CLOSED_STATUS = /已完成|已关闭|已取消|已拒绝|无法复现|已通过|已解决/
const BLOCKED_STATUS = /挂起|阻塞|暂停|等待/
const STALE_MS = 30 * 24 * 60 * 60 * 1000

export type RawWorkItem = {
  id: string
  serialNumber: string
  subject: string
  status: string
  statusName: string
  statusIdentifier: string
  statusStageIdentifier?: string
  priority?: string
  priorityName?: string
  category: string
  categoryName: string
  assignedToName?: string
  spaceId: string
  spaceName: string
  gmtCreate?: string
  gmtModified?: string
  webUrl?: string
}

export type Reason = { level: "pass" | "risk" | "block"; message: string }

export type Item = {
  id: string
  source: "yunxiao"
  serial: string
  title: string
  url?: string
  category: "Req" | "Task" | "Bug" | "Other"
  categoryName: string
  statusName: string
  statusStage?: string
  priority?: string
  priorityName?: string
  spaceId: string
  spaceName: string
  assigneeName?: string
  createdAt?: string
  updatedAt?: string
  readiness: "ready" | "clarify" | "blocked"
  reasons: Reason[]
}

type Envelope<T> = { code: number; message: string; data: T }

export type Client = { baseUrl: string; token: string; organizationId?: string }

async function post<T>(client: Client, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${client.baseUrl}/api/v1/agent-api/yunxiao${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessToken: client.token,
      organizationId: client.organizationId,
      ...body,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = (await response.json()) as Envelope<T>

  if (!response.ok || payload.code !== 200) {
    throw new Error(`${path} ${response.status} ${payload.message || ""}`.trim())
  }

  return payload.data
}

export function user(client: Client) {
  return post<{ user: { id: string; name: string; email: string } }>(client, "/user/current", {})
}

export function projects(client: Client) {
  return post<{ projects: Array<{ id: string; name: string; customCode?: string }> }>(client, "/projects/list", {})
}

export async function search(client: Client, input: { spaceId: string; category: string; userId: string }) {
  return post<{ totalCount: number; workitems: RawWorkItem[] }>(client, "/workitems/search", {
    spaceId: input.spaceId,
    category: input.category,
    page: 1,
    perPage: 100,
    assignedTo: { include: [input.userId], exclude: [] },
  })
}

export function context(client: Client, workItemId: string) {
  return post<{
    context: {
      workItem: RawWorkItem
      description?: string
      comments?: Array<{ id: string; content: string; creatorName?: string; gmtCreate?: string }>
      attachments?: Array<{ id?: string; name?: string; fileName?: string; url?: string }>
      relations?: Array<{
        relationType?: string
        relatedWorkItem?: { serialNumber?: string; subject?: string; statusName?: string }
      }>
    }
  }>(client, "/workitems/context", {
    workItemId,
    analysisConfig: { includeCurrentContent: true, includeCurrentComments: true, includeRelations: true, includeAttachments: true },
  })
}

export function isClosed(item: RawWorkItem) {
  return item.statusStageIdentifier === CLOSED_STAGE || CLOSED_STATUS.test(`${item.statusName ?? ""} ${item.status ?? ""}`)
}

export function readiness(item: RawWorkItem): { readiness: Item["readiness"]; reasons: Reason[] } {
  if (BLOCKED_STATUS.test(item.statusName || item.status || "")) {
    return { readiness: "blocked", reasons: [{ level: "block", message: `状态为「${item.statusName || item.status}」，需要人先处理` }] }
  }

  const reasons: Reason[] = []
  const stale = item.gmtModified ? Date.now() - new Date(item.gmtModified).getTime() > STALE_MS : false

  if (!item.priority) reasons.push({ level: "risk", message: "云效未设置优先级" })
  if (stale) reasons.push({ level: "risk", message: "超过 30 天未更新" })

  if (reasons.length) return { readiness: "clarify", reasons }

  return {
    readiness: "ready",
    reasons: [{ level: "pass", message: "云效字段齐全，状态未阻塞" }],
  }
}

export function toItem(item: RawWorkItem): Item {
  const verdict = readiness(item)
  const category =
    item.category === "Req" || item.category === "Task" || item.category === "Bug" ? item.category : "Other"

  return {
    id: item.id,
    source: "yunxiao",
    serial: item.serialNumber,
    title: item.subject,
    url: item.webUrl,
    category,
    categoryName: item.categoryName || item.category,
    statusName: item.statusName || item.status || "",
    statusStage: item.statusStageIdentifier,
    priority: item.priority,
    priorityName: item.priorityName,
    spaceId: item.spaceId,
    spaceName: item.spaceName,
    assigneeName: item.assignedToName,
    createdAt: item.gmtCreate,
    updatedAt: item.gmtModified,
    readiness: verdict.readiness,
    reasons: verdict.reasons,
  }
}

/**
 * One snapshot of everything assigned to the current user. A failing space only costs its own
 * items: the rest still render and the warning names what was skipped.
 */
export async function collect(
  client: Client,
  userId: string,
  warn: (message: string) => void,
): Promise<Item[]> {
  const list = (await projects(client)).projects
  const queue: Array<{ spaceId: string; spaceName: string; category: string }> = []

  for (const space of list) {
    for (const category of CATEGORIES) queue.push({ spaceId: space.id, spaceName: space.name, category })
  }

  const items: Item[] = []

  const worker = async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return

      try {
        const result = await search(client, { spaceId: next.spaceId, category: next.category, userId })
        for (const raw of result.workitems) {
          if (isClosed(raw)) continue
          items.push(toItem({ ...raw, spaceId: raw.spaceId || next.spaceId, spaceName: raw.spaceName || next.spaceName }))
        }
      } catch (error) {
        warn(`${next.spaceName} / ${next.category} 拉取失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  return dedupe(items)
}

function dedupe(items: Item[]) {
  const seen = new Map<string, Item>()

  for (const item of items) {
    const existing = seen.get(item.id)
    // The same work item can be reached twice when a space lists it under another category.
    if (!existing) seen.set(item.id, item)
  }

  return [...seen.values()]
}

export function sort(items: Item[]) {
  const rank = { blocked: 0, clarify: 1, ready: 2 } as const
  const priority = (value?: string) => {
    const match = value?.match(/^P(\d)$/i)
    return match ? Number(match[1]) : 9
  }

  return [...items].sort((a, b) => {
    if (rank[a.readiness] !== rank[b.readiness]) return rank[a.readiness] - rank[b.readiness]
    if (priority(a.priority) !== priority(b.priority)) return priority(a.priority) - priority(b.priority)
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  })
}
