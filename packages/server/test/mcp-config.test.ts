import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

type ListedMcpServer = { name: string; status: { status: string } }

// 配置里的 MCP 由插件写入 MCP 服务；冷启动的 Location 上第一次请求也必须能看到它
it.live("lists configured MCP servers on the first request to a cold location", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-mcp-config-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(project, "opencode.json"),
        JSON.stringify({
          mcp: { servers: { docs: { type: "remote", url: "https://example.com/mcp", disabled: true } } },
        }),
      ),
    )

    const server = yield* startServer(global)
    const url = new URL("/api/mcp", server.base)
    url.searchParams.set("location[directory]", project)

    // 这是该 Location 的第一次请求，插件此时尚未被其他 handler 预热
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(response.status).toBe(200)
    const body = (yield* Effect.promise(() => response.json())) as { data: ListedMcpServer[] }

    expect(body.data.map((item) => item.name)).toEqual(["docs"])
    expect(body.data[0]?.status.status).toBe("disabled")
  }),
)
