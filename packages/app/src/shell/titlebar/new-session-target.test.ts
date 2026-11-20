import { describe, expect, test } from "bun:test"
import { selectNewSessionDirectory } from "./new-session-target"

describe("new session target", () => {
  test.each([
    {
      name: "an explicitly selected project",
      input: {
        selected: "/projects/selected",
        server: "local",
        recent: { type: "session" as const, server: "local", directory: "/projects/recent" },
      },
      expected: "/projects/selected",
    },
    {
      name: "the recent session while the route is still settling",
      input: {
        server: "local",
        recent: { type: "session" as const, server: "local", directory: "/projects/pier" },
        project: { id: "global", worktree: "/" },
      },
      expected: "/projects/pier",
    },
    {
      name: "the recent draft",
      input: {
        server: "local",
        recent: { type: "draft" as const, server: "local", directory: "/projects/draft" },
        project: { id: "project", worktree: "/projects/other" },
      },
      expected: "/projects/draft",
    },
    {
      name: "a concrete project when no recent directory exists",
      input: {
        server: "local",
        recent: { type: "session" as const, server: "local" },
        project: { id: "project", worktree: "/projects/pier" },
      },
      expected: "/projects/pier",
    },
  ])("uses $name", ({ input, expected }) => {
    expect(selectNewSessionDirectory(input)).toBe(expected)
  })

  test("does not use a global project's filesystem root as a directory", () => {
    expect(
      selectNewSessionDirectory({
        server: "local",
        recent: { type: "session", server: "remote", directory: "/projects/remote" },
        project: { id: "global", worktree: "/" },
      }),
    ).toBeUndefined()
  })
})
