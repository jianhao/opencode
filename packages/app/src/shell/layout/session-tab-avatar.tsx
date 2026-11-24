import type { LocalProject } from "@/shell/state/layout"
import { Icon } from "@opencode/ui/icon"
import { Show } from "solid-js"
import "./session-tab-avatar.css"

// 会话标签统一使用同一个会话图标，不再按项目/目录生成随机图案。
export function SessionTabAvatarView(props: { project?: LocalProject; directory: string; unread: boolean }) {
  return (
    <span class="session-tab-avatar" data-unread={props.unread ? "" : undefined} aria-hidden="true">
      <Icon name="bubble-5" size="small" />
      <Show when={props.unread}>
        <i />
      </Show>
    </span>
  )
}
