import { startTransition } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { isRootDirectory } from "@opencode/util/path"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "./tabs"

export function createProjectSessionActions() {
  const global = useGlobal()

  const tabs = useTabs()

  return {
    openProjectNewSession(conn: ServerConnection.Any, directory: string) {
      // 文件系统根不是工作目录；数据修复前 global 的占位 worktree 仍可能是根，不能拿它新建会话。
      if (isRootDirectory(directory)) return
      global.serverCtx(ServerConnection.key(conn))?.projects.touch(directory)
      void tabs.newDraft({ server: ServerConnection.key(conn), directory })
    },
    openProjectSession(
      conn: ServerConnection.Any,
      directory: string,
      session: SessionInfo,
      options?: { preview?: boolean },
    ) {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      if (!ctx) return
      void ctx.data.session.message.sync(session.id).catch(() => undefined)
      void startTransition(() => {
        ctx.data.session.remember(session)
        ctx.projects.touch(directory)

        if (options?.preview) {
          tabs.previewSession({ server: ServerConnection.key(conn), sessionId: session.id })

          return
        }

        const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })

        tabs.select(tab)
      })
    },
  }
}
