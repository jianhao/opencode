export type StatusTone =
  | "analysis"
  | "review"
  | "confirm"
  | "design"
  | "todo"
  | "reopen"
  | "blocked"
  | "doing"
  | "developed"
  | "suspended"
  | "testing"
  | "testing-active"
  | "acceptance"
  | "release"
  | "done"
  | "closed"
  | "rejected"
  | "default"

const includesAny = (value: string, keywords: readonly string[]) => keywords.some((key) => value.includes(key))

/**
 * 颜色分组与 `tools/yunxiao-web/src/utils/workitemStatus.ts` 保持一致，
 * 让工作台和云效列表对同一状态使用同一种颜色。状态顺序由接口返回，不在这里写死。
 */
export function statusTone(statusName: string): StatusTone {
  const name = statusName.trim()

  if (!name) return "default"

  if (includesAny(name, ["需求分析", "分析中", "分析完成", "待讨论"])) return "analysis"

  if (includesAny(name, ["评审", "待审核"])) return "review"

  if (includesAny(name, ["待确认", "已确认", "已选择"])) return "confirm"

  if (includesAny(name, ["设计中", "设计完成"])) return "design"

  if (includesAny(name, ["待处理", "待进行", "待开发", "就绪", "未执行", "已分配"])) return "todo"

  if (includesAny(name, ["再次打开", "重新打开"])) return "reopen"

  if (includesAny(name, ["阻塞", "测试未通过", "未通过", "业务测试未通过", "等待调整", "需修改"])) return "blocked"

  if (includesAny(name, ["开发中", "进行中", "处理中", "修复中", "执行中"])) return "doing"

  if (name === "开发完成") return "developed"

  if (includesAny(name, ["挂起", "推迟", "延期"])) return "suspended"

  if (includesAny(name, ["待测试", "待QA测试", "待产品测试", "待冒烟", "开发完成待业务测试"])) return "testing"

  if (includesAny(name, ["测试中", "集成测试"])) return "testing-active"

  if (includesAny(name, ["测试完成", "待验收", "验收中", "已修复", "业务测试通过"])) return "acceptance"

  if (includesAny(name, ["待发布", "预发", "灰度", "发布中"])) return "release"

  if (
    includesAny(name, [
      "发布完成",
      "已发布",
      "已部署",
      "已完成",
      "已通过",
      "已解决",
      "已验证",
      "任务完成",
      "缺陷已修复",
    ])
  )
    return "done"

  if (includesAny(name, ["已关闭", "关闭"])) return "closed"

  if (includesAny(name, ["拒绝", "取消", "无效", "重复", "无法", "暂不修复"])) return "rejected"

  return "default"
}
