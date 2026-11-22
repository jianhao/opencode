import { describe, expect, test } from "bun:test"
import { statusRank, statusTone } from "./status-tone"

describe("workbench status tone", () => {
  test("maps visible Yunxiao statuses into stable color groups", () => {
    expect(
      [
        "处理中",
        "开发完成待QA测试",
        "开发完成待产品测试",
        "开发完成待冒烟",
        "挂起",
        "修复待测试",
        "待处理",
        "已挂起",
      ].map(statusTone),
    ).toEqual(["doing", "testing", "testing", "testing", "suspended", "testing", "todo", "suspended"])
  })

  test("uses the Yunxiao status order when sorting the all-items view", () => {
    expect(statusRank("处理中")).toBeLessThan(statusRank("挂起"))
    expect(statusRank("挂起")).toBeLessThan(statusRank("修复待测试"))
    expect(statusRank("开发完成待QA测试")).toBeLessThan(statusRank("已完成"))
    expect(statusRank("新状态")).toBeGreaterThan(statusRank("已取消"))
  })
})
