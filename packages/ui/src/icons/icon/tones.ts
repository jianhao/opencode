import type { IconName } from "../catalog"

export type IconTone = "accent" | "info" | "success" | "warning" | "neutral"

/**
 * 只有“对象类”图标带语义色，动作、导航、工具栏图标保持中性继承文字色。
 * 颜色在 `icon.css` 里映射到主题 token，跟随主题主色与状态色，不写死十六进制。
 */
const tones: Partial<Record<IconName, IconTone>> = {
  // 文件与知识对象：主题主色
  folder: "accent",
  "folder-add-left": "accent",
  filetree: "accent",
  "file-tree": "accent",
  "file-tree-active": "accent",
  archive: "accent",
  "file-document": "accent",
  "open-file": "accent",
  "post-skill": "accent",
  "graduation-cap": "accent",

  // 设置与导航：按语义分组着色，避免整排灰图标
  appearance: "accent",
  sliders: "accent",
  extensions: "accent",
  "settings-gear": "accent",
  "layout-left": "accent",
  "layout-left-full": "accent",
  "grid-plus": "accent",
  cube: "accent",
  notifications: "warning",
  keyboard: "info",
  flask: "warning",
  info: "info",
  help: "info",
  status: "info",
  mcp: "info",
  discord: "info",
  task: "success",
  "outline-pair": "success",
  "outline-list-changelog": "info",

  // 代码、终端、网络与分享：信息色
  "bubble-5": "info",
  comment: "info",
  "speech-bubble": "info",
  "code-slash": "info",
  code: "info",
  "code-lines": "info",
  "outline-code-brackets": "info",
  console: "info",
  terminal: "info",
  "terminal-active": "info",
  "outline-console": "info",
  server: "info",
  globe: "info",
  "outline-globe": "info",
  "outline-globe-plus": "info",
  copy: "info",
  "outline-copy": "info",
  download: "info",
  "cloud-upload": "info",
  link: "info",
  share: "info",
  "outline-share": "info",
  monitor: "info",
  selector: "info",
  "select-element": "info",
  "window-cursor": "info",
  "window-analytics": "info",
  "square-arrow-top-right": "info",
  "arrow-up-right": "info",
  "outline-arrow-up-right": "info",
  "outline-square-arrow": "info",
  "outline-arrow-to-corner-top-right": "info",

  // 分支、工作区与校验：成功色
  branch: "success",
  "branch-out": "success",
  "outline-worktree": "success",
  check: "success",
  "check-small": "success",
  "circle-check": "success",
  shield: "success",
  lock: "success",
  enter: "success",
  workspace: "success",
  "workspace-new": "success",
  "workspace-isolated": "success",

  // 编辑、模型与提醒：警告色
  edit: "warning",
  "edit-small-2": "warning",
  "pencil-line": "warning",
  warning: "warning",
  "circle-exclamation": "warning",
  "outline-hexagonal-warning": "warning",
  photo: "warning",
  "outline-photo": "warning",
  models: "warning",
  providers: "warning",
  review: "warning",
  "review-active": "warning",
  brain: "warning",
  "outline-brain": "warning",
}

export function iconTone(name: IconName): IconTone {
  return tones[name] ?? "neutral"
}
