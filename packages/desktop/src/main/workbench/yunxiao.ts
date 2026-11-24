/**
 * Yunxiao reads go through the local frontend-server agent API, which already owns the Projex
 * client, the shared organization and the token fallback. The workbench never talks to Aliyun
 * directly and never writes.
 */

const CATEGORIES = ["Req", "Task", "Bug"] as const
const CONCURRENCY = 4
const TIMEOUT_MS = 15000
const ASSET_TIMEOUT_MS = 20000
const ASSET_MAX_BYTES = 8 * 1024 * 1024

// 图标之类的小图重下成本低，不值得占缓存；正文截图通常几十到几百 KB。
const ASSET_CACHE_MIN_BYTES = 32 * 1024

// 缓存的是原始字节，base64 后字符串大约再涨三分之一。
const ASSET_CACHE_MAX_BYTES = 64 * 1024 * 1024

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
  creatorName?: string
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
  creatorName?: string
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

/**
 * 云效状态下拉项来自 frontend-server 聚合的工作流状态（各空间、各分类去重，带缓存），
 * 工作台不再自己维护一份写死的状态清单。
 */
export async function statuses(client: Client) {
  const result = await post<{ statusOptions?: Array<{ label?: string; value?: string }> }>(
    client,
    "/metadata/filter-options",
    {},
  )

  return (result.statusOptions ?? [])
    .map((option) => (option.label ?? option.value ?? "").trim())
    .filter((name) => name.length > 0)
}

const PAGE_SIZE = 100
// 一个人在一个空间里能背几百条历史工单，翻页上限只是防御，正常两三轮就结束。
const MAX_PAGES = 20

/**
 * 拉全一个空间 + 类型下指派给当前用户的全部工作项：单页 100 条会把历史工单截断，
 * 导致“明明有这条却搜不到”。
 */
export async function search(client: Client, input: { spaceId: string; category: string; userId: string }) {
  const workitems: RawWorkItem[] = []
  let totalCount = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await post<{ totalCount: number; workitems: RawWorkItem[] }>(client, "/workitems/search", {
      spaceId: input.spaceId,
      category: input.category,
      page,
      perPage: PAGE_SIZE,
      assignedTo: { include: [input.userId], exclude: [] },
    })

    totalCount = result.totalCount ?? workitems.length + (result.workitems?.length ?? 0)
    workitems.push(...(result.workitems ?? []))

    if (workitems.length >= totalCount || !result.workitems?.length) break
  }

  return { totalCount, workitems }
}

// 图片按 URL 缓存下载结果：同一张截图反复打开详情时不必再走一遍云效。
const assets = new Map<string, { data: string; bytes: number }>()
let assetBytes = 0

/** 换账号或换服务地址后旧的图片不能再复用。 */
export function clearAssets() {
  assets.clear()
  assetBytes = 0
}

/**
 * 云效正文图片走 assets/download 代理：直接 &lt;img src&gt; 需要登录态，渲染进程拿不到令牌。
 * 返回 data URL，详情可以离线展示；失败由调用方保留原地址。
 * `refresh` 用于手动刷新详情：跳过缓存重下，并把新结果写回去。
 */
export async function asset(
  client: Client,
  input: { workItemId: string; url: string },
  options?: { refresh?: boolean },
) {
  const cached = options?.refresh ? undefined : assets.get(input.url)

  if (cached) {
    // 命中后移到队尾，淘汰时先丢最久没用的。
    assets.delete(input.url)
    assets.set(input.url, cached)

    return cached.data
  }

  const response = await fetch(`${client.baseUrl}/api/v1/agent-api/yunxiao/assets/download`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessToken: client.token,
      organizationId: client.organizationId,
      workItemId: input.workItemId,
      url: input.url,
    }),
    signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`assets/download ${response.status}`)

  const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? ""

  if (!type.startsWith("image/")) throw new Error(`assets/download 返回 ${type || "未知类型"}`)

  const declared = Number(response.headers.get("content-length") ?? 0)

  if (declared > ASSET_MAX_BYTES) throw new Error("图片超过 8MB")

  const buffer = Buffer.from(await response.arrayBuffer())

  if (buffer.byteLength > ASSET_MAX_BYTES) throw new Error("图片超过 8MB")

  const data = `data:${type};base64,${buffer.toString("base64")}`

  if (buffer.byteLength < ASSET_CACHE_MIN_BYTES) return data

  const previous = assets.get(input.url)
  assets.delete(input.url)
  assetBytes -= previous?.bytes ?? 0
  assets.set(input.url, { data, bytes: buffer.byteLength })
  assetBytes += buffer.byteLength

  for (const [url, entry] of assets) {
    if (assetBytes <= ASSET_CACHE_MAX_BYTES) break
    assets.delete(url)
    assetBytes -= entry.bytes
  }

  return data
}

// 云效正文图片的地址形态，只有这种需要凭令牌下载；其余公开地址交给浏览器直连。
const PROXIED_IMAGE = /\/projex\/api\/workitem\/file\/url\?/i

/**
 * 把详情 HTML 里的云效图片替换成 data URL，避免渲染进程因缺少登录态显示裂图。
 * 单张失败只保留原地址，不影响正文其余内容。
 */
export async function inlineImages(
  client: { baseUrl: string; token: string; organizationId?: string },
  workItemId: string,
  html: string,
  options?: { refresh?: boolean },
) {
  if (!html || !PROXIED_IMAGE.test(html)) return html

  const replaced = new Map<string, string>()

  await Promise.all(
    [...html.matchAll(/<img\b[^>]*>/gi)].map(async ([tag]) => {
      const source = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i)
      const raw = source?.[2] ?? source?.[3]

      if (!raw) return

      const url = raw.replace(/\\+/g, "").replace(/&amp;/gi, "&")

      if (!PROXIED_IMAGE.test(url) || replaced.has(tag)) return

      try {
        replaced.set(tag, await asset(client, { workItemId, url }, options))
      } catch {
        // 保留原地址，正文其他内容仍可阅读。
      }
    }),
  )

  if (replaced.size === 0) return html

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const data = replaced.get(tag)

    if (!data) return tag

    return tag.replace(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i, `src="${data}"`)
  })
}

export type ContextConfig = {
  includeCurrentContent: boolean
  includeCurrentComments: boolean
  includeParentContent: boolean
  includeParentComments: boolean
  includeLinkedContent: boolean
  includeLinkedComments: boolean
  includeChildContent: boolean
  includeChildComments: boolean
  includeAttachments: boolean
  includeRelations: boolean
  includeActivities: boolean
  includeExternalLinks: boolean
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  includeCurrentContent: true,
  includeCurrentComments: true,
  includeParentContent: true,
  includeParentComments: true,
  includeLinkedContent: true,
  includeLinkedComments: true,
  includeChildContent: true,
  includeChildComments: true,
  includeAttachments: true,
  includeRelations: true,
  includeActivities: true,
  includeExternalLinks: true,
}

export type RawContext = {
  workItem: RawWorkItem
  description?: string
  comments?: Array<{ id: string; content: string; creatorName?: string; gmtCreate?: string }>
  attachments?: Array<{ id?: string; name?: string; fileName?: string; url?: string; downloadUrl?: string }>
  relations?: Array<{
    relationType?: string
    relatedWorkItem?: { serialNumber?: string; subject?: string; statusName?: string }
  }>
  activities?: Array<{
    actionType?: string
    eventTime?: string
    operatorName?: string
    propertyName?: string
    oldValue?: Array<{ displayValue?: string }>
    newValue?: Array<{ displayValue?: string }>
  }>
  parentContext?: RawContext | null
  linkedContexts?: RawContext[]
  childContexts?: RawContext[]
}

export function context(client: Client, workItemId: string, config: ContextConfig = DEFAULT_CONTEXT_CONFIG) {
  return post<{ context: RawContext }>(client, "/workitems/context", {
    workItemId,
    analysisConfig: config,
  })
}

export function readiness(item: RawWorkItem): { readiness: Item["readiness"]; reasons: Reason[] } {
  if (BLOCKED_STATUS.test(item.statusName || item.status || "")) {
    return {
      readiness: "blocked",
      reasons: [{ level: "block", message: `状态为「${item.statusName || item.status}」，需要人先处理` }],
    }
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
    creatorName: item.creatorName,
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
export async function collect(client: Client, userId: string, warn: (message: string) => void): Promise<Item[]> {
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
          // 已结束的工作项也收进来：由“云效状态配置”的包含/排除决定是否展示。
          items.push(
            toItem({ ...raw, spaceId: raw.spaceId || next.spaceId, spaceName: raw.spaceName || next.spaceName }),
          )
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
