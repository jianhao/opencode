import { isRootDirectory } from "@opencode/util/path"

export type NewSessionRecent =
  | { readonly type: "draft"; readonly server: string; readonly directory: string }
  | { readonly type: "session"; readonly server: string; readonly directory?: string }

export type NewSessionProject = {
  readonly id?: string
  readonly worktree: string
}

export function selectNewSessionDirectory(input: {
  selected?: string
  server: string
  recent?: NewSessionRecent
  project?: NewSessionProject
}) {
  // 文件系统根不是会话目录：旧库里 global 的占位 worktree 可能是根，不能拿它开新会话。
  if (input.selected && !isRootDirectory(input.selected)) return input.selected

  if (input.recent?.server === input.server && input.recent.directory && !isRootDirectory(input.recent.directory))
    return input.recent.directory

  // global 是多个无 root commit 仓库共用的占位项目，它的 worktree 不能作为会话目录。
  if (!input.project || input.project.id === "global" || isRootDirectory(input.project.worktree)) return

  return input.project.worktree
}
