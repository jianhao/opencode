import type { SessionInfo } from "@opencode/client/promise"
import { displayName, getProjectAvatarGenerated } from "@opencode/ui/project-avatar"
import { pathKey } from "@/workspaces/path-key"
import { isProjectDirectory } from "@/workspaces/paths"
import type { ServerConnection } from "@/runtime/server/registry"
import type { HomeProjectSelection } from "@/shell/state/layout"

export function compareSessionTime(a: SessionInfo, b: SessionInfo) {
  const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)

  if (updated !== 0) return updated

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function toggleHomeProjectSelection(
  current: HomeProjectSelection | undefined,
  server: ServerConnection.Key,
  directory: string,
): HomeProjectSelection {
  if (current?.server === server && current.directory === directory) return { server }

  return { server, directory }
}

export function homeProjectDirectories(result: string | string[] | null) {
  if (!result) return []

  return Array.isArray(result) ? result : [result]
}

// global 是多个无 root commit 仓库共用的占位项目，它记录的 worktree 不是会话目录，项目名按会话目录取。
export function sessionProjectName(
  project: { id?: string; name?: string; worktree: string } | undefined,
  directory: string,
) {
  if (project?.id !== "global") return displayName(project ?? { worktree: directory })

  return displayName({ worktree: directory })
}

// global 项目的 worktree 是占位根，不适用于会话级操作；项目身份仍保持原样。
export function sessionProjectRoot(
  project: { id?: string; worktree: string } | undefined,
  directory: string,
) {
  return project && project.id !== "global" ? project.worktree : directory
}

// global 的生成头像也应按会话目录区分，否则多个无 root commit 的目录会共用同一个图案。
export function sessionProjectAvatarSeed(
  project: { id?: string; worktree?: string; icon?: { color?: string; url?: string; override?: string } } | undefined,
  directory: string,
) {
  return getProjectAvatarGenerated(
    project?.id === "global" ? { ...project, worktree: directory } : project ?? { worktree: directory },
  )
}

export function projectForSession<T extends { id?: string; worktree: string; sandboxes?: string[] }>(
  session: SessionInfo,
  projects: T[],
) {
  const matching = projects.filter((project) => project.id === session.projectID)

  if (matching.length === 1) return matching[0]

  if (matching.length > 1) {
    const directory = pathKey(session.location.directory)

    const exact =
      matching.find((project) => pathKey(project.worktree) === directory) ??
      matching.find((project) => project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory))

    if (exact) return exact

    return (
      matching
        .filter((project) => isProjectDirectory(project, session.location.directory))
        .sort((a, b) => b.worktree.length - a.worktree.length)[0] ?? matching.at(-1)
    )
  }

  const directory = pathKey(session.location.directory)

  const exact =
    projects.find((project) => pathKey(project.worktree) === directory) ??
    projects.find((project) => project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory))

  if (exact) return exact

  return projects
    .filter((project) => isProjectDirectory(project, session.location.directory))
    .sort((a, b) => b.worktree.length - a.worktree.length)[0]
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 这里就是接收任意抛出值的边界。
export const errorMessage = (err: unknown, fallback: string) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 任意抛出值只能在边界运行时收窄。
  if (err && typeof err === "object" && "data" in err) {
    // SAFETY: 上面的运行时检查确认了对象包含 data 字段。
    const data = (err as { data?: { message?: string } }).data

    if (data?.message) return data.message
  }

  if (err instanceof Error) return err.message

  return fallback
}
