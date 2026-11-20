import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  removeStaleDevServiceRegistration,
  selectDevDesktopPids,
  selectOrphanedSidecars,
  selectOwnedSidecars,
  type DevServiceListener,
} from "./dev-service"

const root = "/repo/opencode"

const sidecar = (pid: number, ppid = 1, command = `/repo/opencode/packages/cli/src/index.ts serve --service --port 3084`) => ({
  pid,
  ppid,
  command,
})

describe("desktop dev sidecar cleanup", () => {
  test("reclaims this repository's orphaned sidecars", () => {
    expect(selectOrphanedSidecars([sidecar(42), sidecar(43)], root)).toEqual([42, 43])
  })

  test.each([
    {
      name: "another application",
      listener: sidecar(42, 1, "/Applications/Other.app/Contents/MacOS/Other --port 3084"),
    },
    {
      name: "another repository",
      listener: sidecar(42, 1, "/repo/other/packages/cli/src/index.ts serve --service --port 3084"),
    },
    {
      name: "a repository with the same prefix",
      listener: sidecar(42, 1, "/repo/opencode-other/packages/cli/src/index.ts serve --service --port 3084"),
    },
    {
      name: "a different port",
      listener: sidecar(42, 1, "/repo/opencode/packages/cli/src/index.ts serve --service --port 4096"),
    },
    {
      name: "an active sidecar",
      listener: sidecar(42, 77),
    },
  ])("refuses to stop $name", ({ listener }) => {
    expect(() => selectOrphanedSidecars([listener], root)).toThrow("Port 3084 is already in use")
  })

  test("does nothing when the port is free", () => {
    expect(selectOrphanedSidecars([], root)).toEqual([])
  })

  test("recognizes owned sidecars while their dev desktop is active", () => {
    expect(selectOwnedSidecars([sidecar(42, 77)], root)).toEqual([sidecar(42, 77)])
  })

  test("selects only the parent dev desktop app", () => {
    const app = "/repo/opencode/packages/desktop/node_modules/.cache/opencode-dev/cache/OpenCode Dev.app/Contents/MacOS/Electron"

    expect(
      selectDevDesktopPids(
        [sidecar(42, 77), sidecar(43, 88)],
        [
          { pid: 77, command: `${app} .` },
          { pid: 88, command: "/Applications/Other.app/Contents/MacOS/Other" },
        ],
        root,
      ),
    ).toEqual([77])
  })

  test("removes a registration whose service already exited", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-dev-registration-"))
    const file = join(directory, "service-local.json")

    try {
      await Bun.write(
        file,
        JSON.stringify({ pid: 99_999_999, url: "http://0.0.0.0:3084" }),
      )

      expect(await removeStaleDevServiceRegistration(file)).toBe(true)
      expect(await Bun.file(file).exists()).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("keeps the registration while its service is running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-dev-registration-"))
    const file = join(directory, "service-local.json")

    try {
      await Bun.write(
        file,
        JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:3084" }),
      )

      expect(await removeStaleDevServiceRegistration(file)).toBe(false)
      expect(await Bun.file(file).exists()).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
