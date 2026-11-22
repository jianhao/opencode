import { describe, expect, test } from "bun:test"
import { isClosed, readiness, sort, toItem, type Item, type RawWorkItem } from "./yunxiao"

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

describe("isClosed", () => {
  test("keeps an active stage", () => {
    expect(isClosed(base)).toBe(false)
  })

  test("drops the done stage whatever its status name", () => {
    expect(isClosed({ ...base, statusStageIdentifier: "4", status: "开发中" })).toBe(true)
  })

  test("drops closed names when a space uses another stage id", () => {
    expect(isClosed({ ...base, statusStageIdentifier: "12", status: "已取消" })).toBe(true)
    expect(isClosed({ ...base, statusName: "无法复现" })).toBe(true)
  })
})

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
