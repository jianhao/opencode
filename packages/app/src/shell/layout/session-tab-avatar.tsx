import { sessionProjectAvatarSeed, sessionProjectName } from "@/shell/layout/helpers"
import type { LocalProject } from "@/shell/state/layout"
import { getProjectAvatarSource, getProjectAvatarVariant, ProjectAvatar } from "@opencode/ui/project-avatar"

// The project avatar never changes while a session works: callers show `ActivityRing` at the row's trailing edge, as
// session tabs do.
export function SessionTabAvatarView(props: { project?: LocalProject; directory: string; unread: boolean }) {
  return (
    <ProjectAvatar
      fallback={sessionProjectName(props.project, props.directory)}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      generated={sessionProjectAvatarSeed(props.project, props.directory)}
      unread={props.unread}
    />
  )
}
