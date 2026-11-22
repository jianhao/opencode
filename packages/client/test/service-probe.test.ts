import { expect, test } from "bun:test"
import { probeResult } from "../src/service-probe"

test("probes a wildcard service through loopback", async () => {
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    fetch() {
      return Response.json({ version: "test", pid: process.pid })
    },
  })

  try {
    const result = await probeResult({
      url: `http://0.0.0.0:${server.port}`,
      pid: process.pid,
      version: "test",
    })

    expect(result.service).toMatchObject({
      compatible: true,
      state: "ready",
      version: "test",
      endpoint: { url: `http://127.0.0.1:${server.port}/` },
    })
  } finally {
    server.stop(true)
  }
})
