import { describe, expect, test } from "bun:test"
import { statusTone } from "./status-tone"

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
})
