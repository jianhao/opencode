import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  errorMessage,
  projectForSession,
  sessionProjectAvatarSeed,
  sessionProjectName,
  sessionProjectRoot,
  toggleHomeProjectSelection,
} from "./helpers"
import { ServerConnection } from "@/runtime/server/registry"

const serverKey = ServerConnection.Key.make

  const session = (input: Partial<SessionInfo> & Pick<SessionInfo, "id"> & { directory: string }) => {
    // SAFETY: 测试夹具补齐本项目 helper 读取的字段；directory 仅用于构造 location 后丢弃。
    return {
      projectID: "project",
      title: "",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      parentID: undefined,
      time: { created: 0, updated: 0, archived: undefined },
      ...input,
      location: { directory: input.directory },
      directory: undefined,
    } as SessionInfo
  }

type Project = {
  id: string
  worktree: string
  sandboxes: string[]
  worktrees?: { directory: string; strategy?: string }[]
}

const enriched: { name: string; project: Project }[] = [
  {
    name: "matching project id",
    project: {
      id: "project",
      worktree: "/repo",
      sandboxes: ["/workspaces/feature"],
      worktrees: [{ directory: "/repo" }, { directory: "/workspaces/feature", strategy: "git" }],
    },
  },
  { name: "stale project id", project: { id: "updated", worktree: "/repo", sandboxes: ["/workspaces/feature"] } },
]

describe("layout workspace helpers", () => {
  test.each(enriched)("keeps the enriched project for a nested workspace session ($name)", ({ project }) => {
    expect(
      projectForSession(session({ id: "feature", directory: "/workspaces/feature/packages/app" }), [project]),
    ).toBe(project)
  })

  test("names a global project after the session's own directory", () => {
    const global = { id: "global", worktree: "/" }

    expect(sessionProjectName(global, "/repo/pier")).toBe("pier")
    expect(sessionProjectName({ ...global, name: "stale" }, "/repo/other")).toBe("other")
    expect(sessionProjectName({ id: "project", worktree: "/repo" }, "/repo/packages/app")).toBe("repo")
  })

  test("uses the session directory for global project actions and avatars", () => {
    const global = { id: "global", worktree: "/" }

    expect(sessionProjectRoot(global, "/repo/pier")).toBe("/repo/pier")
    expect(sessionProjectRoot({ id: "project", worktree: "/repo" }, "/repo/packages/app")).toBe("/repo")
    expect(sessionProjectAvatarSeed(global, "/repo/pier")).toBe("/repo/pier")
    expect(sessionProjectAvatarSeed({ ...global, icon: { color: "green" } }, "/repo/pier")).toBeUndefined()
  })

  test("scopes home project selection by server", () => {
    expect(
      toggleHomeProjectSelection(undefined, serverKey("https://debian.example"), "/home/luke/repos/amazon"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      directory: "/home/luke/repos/amazon",
    })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://windows.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
