import { describe, expect, test } from "bun:test"
import { asset, clearAssets, inlineImages, readiness, sort, toItem, type Item, type RawWorkItem } from "./yunxiao"

const base: RawWorkItem = {
  id: "1",
  serialNumber: "ROSCRW-1",
  subject: "标题",
  status: "开发中",
  statusName: "开发中",
  statusIdentifier: "100010",
  statusStageIdentifier: "2",
  category: "Task",
  categoryName: "任务",
  spaceId: "space",
  spaceName: "空间",
  gmtCreate: new Date().toISOString(),
  gmtModified: new Date().toISOString(),
}

describe("readiness", () => {
  test("ready when cloud fields are complete", () => {
    expect(readiness({ ...base, priority: "P2" })).toEqual({
      readiness: "ready",
      reasons: [{ level: "pass", message: "云效字段齐全，状态未阻塞" }],
    })
  })

  test("blocked when the status needs a person", () => {
    expect(readiness({ ...base, status: "挂起", statusName: "挂起", priority: "P1" }).readiness).toBe("blocked")
  })

  test("clarify when the priority is missing", () => {
    const verdict = readiness({ ...base, priority: undefined })
    expect(verdict.readiness).toBe("clarify")
    expect(verdict.reasons.map((reason) => reason.level)).toEqual(["risk"])
  })

  test("clarify when nothing moved for 30 days", () => {
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    const verdict = readiness({ ...base, priority: "P2", gmtModified: stale })
    expect(verdict.readiness).toBe("clarify")
    expect(verdict.reasons[0]?.message).toContain("30 天")
  })

  test("blocked wins over a missing priority", () => {
    expect(readiness({ ...base, status: "挂起", statusName: "挂起", priority: undefined }).readiness).toBe("blocked")
  })
})

describe("toItem", () => {
  test("keeps the category and links the cloud url", () => {
    const item = toItem({ ...base, priority: "P0", webUrl: "https://devops.aliyun.com/x" })
    expect(item.category).toBe("Task")
    expect(item.url).toBe("https://devops.aliyun.com/x")
    expect(item.serial).toBe("ROSCRW-1")
  })

  test("falls back to Other for an unknown category", () => {
    expect(toItem({ ...base, category: "Unknown", priority: "P0" }).category).toBe("Other")
  })
})

describe("sort", () => {
  const item = (input: Partial<Item> & Pick<Item, "id">): Item => ({
    id: input.id,
    source: "yunxiao",
    serial: input.serial ?? input.id,
    title: "",
    category: "Task",
    categoryName: "任务",
    statusName: "开发中",
    spaceId: "space",
    spaceName: "空间",
    readiness: input.readiness ?? "ready",
    reasons: [],
    ...input,
  })

  test("puts blocked first, then priority, then newest", () => {
    const order = sort([
      item({ id: "ready-old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      item({ id: "blocked", readiness: "blocked" }),
      item({ id: "p0", priority: "P0", updatedAt: "2026-01-02T00:00:00.000Z" }),
      item({ id: "p1", priority: "P1", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ]).map((entry) => entry.id)

    expect(order).toEqual(["blocked", "p0", "p1", "ready-old"])
  })

  test("does not mutate the input", () => {
    const input = [item({ id: "a" }), item({ id: "b", readiness: "blocked" })]
    sort(input)
    expect(input.map((entry) => entry.id)).toEqual(["a", "b"])
  })
})

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function proxy(handler: () => Response) {
  return Bun.serve({ port: 0, fetch: handler })
}

describe("Yunxiao images", () => {
  test("turns a proxied file url into a data url and leaves public images alone", async () => {
    const server = proxy(() => new Response(PNG, { headers: { "content-type": "image/png" } }))
    const client = { baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }

    try {
      const html =
        '<p><img alt="截图" src="https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=abc&amp;x=1"></p>' +
        '<img src="https://example.com/public.png">'
      const output = await inlineImages(client, "work-item", html)

      expect(output).toContain('src="data:image/png;base64,')
      expect(output).toContain('alt="截图"')
      expect(output).toContain("https://example.com/public.png")
      expect(output).not.toContain("projex/api/workitem/file/url")
    } finally {
      server.stop(true)
    }
  })

  test("keeps the original src when the proxy cannot download the file", async () => {
    const server = proxy(() => new Response("missing", { status: 404 }))
    const client = { baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }

    try {
      const html = '<img src="https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=gone">'

      expect(await inlineImages(client, "work-item", html)).toBe(html)
    } finally {
      server.stop(true)
    }
  })

  test("caches a large download until a refresh asks for it again", async () => {
    clearAssets()
    let requests = 0
    const big = new Uint8Array(600 * 1024)
    big.set(PNG)

    const server = proxy(() => {
      requests++

      return new Response(big, { headers: { "content-type": "image/png" } })
    })

    const client = { baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }
    const url = "https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=big"

    try {
      await asset(client, { workItemId: "work", url })
      await asset(client, { workItemId: "work", url })
      expect(requests).toBe(1)

      await asset(client, { workItemId: "work", url }, { refresh: true })
      expect(requests).toBe(2)
    } finally {
      clearAssets()
      server.stop(true)
    }
  })

  test("re-downloads a small image instead of keeping it", async () => {
    clearAssets()
    let requests = 0

    const server = proxy(() => {
      requests++

      return new Response(PNG, { headers: { "content-type": "image/png" } })
    })

    const client = { baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }
    const url = "https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=small"

    try {
      await asset(client, { workItemId: "work", url })
      await asset(client, { workItemId: "work", url })
      expect(requests).toBe(2)
    } finally {
      clearAssets()
      server.stop(true)
    }
  })

  test("rejects a payload that is not an image", async () => {
    const server = proxy(() => new Response("{}", { headers: { "content-type": "application/json" } }))

    try {
      const client = { baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }

      await expect(asset(client, { workItemId: "work", url: "https://example.com/a" })).rejects.toThrow(
        "application/json",
      )
    } finally {
      server.stop(true)
    }
  })
})
