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

// 云效列表的默认状态顺序；未识别的新状态统一放到末尾。
const STATUS_GROUPS = [
  ["需求分析", "分析中", "分析完成", "待讨论", "待讨论确定"],
  ["待评审", "待审核", "评审中", "迭代评审中", "需求评审中", "待产品评审", "产品评审完成"],
  ["待确认", "已确认", "已选择"],
  ["设计中", "设计完成"],
  ["待处理", "再次打开", "重新打开", "待进行", "待开发", "就绪（待开发）", "未执行", "已分配任务", "任务已分配"],
  ["阻塞", "测试未通过", "未通过", "业务测试未通过", "等待调整", "需修改"],
  ["开发中", "进行中", "处理中", "修复中", "执行中", "开发完成"],
  ["挂起", "已挂起", "推迟修复", "延期处理"],
  [
    "待测试",
    "开发完成待测试",
    "开发完成待业务测试",
    "开发完成待QA测试",
    "开发完成待产品测试",
    "开发完成待冒烟",
    "任务待测试",
    "任务完成待测试",
    "修复待测试",
  ],
  ["测试中", "测试中（联调）", "业务测试中", "集成测试中", "测试完成"],
  ["待验收", "验收中", "已修复", "业务测试通过"],
  ["待发布", "预发中", "灰度中", "发布中", "发布完成", "代码已部署", "已发布"],
  [
    "已完成",
    "已通过",
    "已解决",
    "已验证",
    "任务完成",
    "缺陷已修复",
    "关闭（已验证）",
    "已关闭（已修复）",
    "已关闭",
    "关闭",
  ],
  [
    "暂不修复",
    "无效缺陷",
    "重复缺陷",
    "已拒绝（不修复）",
    "已拒绝",
    "拒绝",
    "需求取消",
    "取消",
    "已取消",
    "已关闭（未修复）",
    "设计如此",
    "无法复现",
    "无法重现",
  ],
] as const

const STATUS_ORDER = STATUS_GROUPS.flat()

const STATUS_WEIGHT = new Map<string, number>(STATUS_ORDER.map((status, index) => [status, index]))

export function statusRank(statusName: string) {
  return STATUS_WEIGHT.get(statusName.trim()) ?? STATUS_ORDER.length
}

/**
 * 分组与 `tools/yunxiao-web/src/utils/workitemStatus.ts` 保持一致，
 * 让工作台和云效列表对同一状态使用同一种颜色。
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
