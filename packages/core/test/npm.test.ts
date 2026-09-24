import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { which } from "@opencode-ai/core/util/which"
import { tmpdir } from "./fixture/tmpdir"

const win = process.platform === "win32"

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

const npmLayer = (cache: string) =>
  AppNodeBuilder.build(Npm.node, [[Global.node, Global.layerWith({ cache, state: path.join(cache, "state") })]])

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@opencode/acme")).toBe("@opencode/acme")
    expect(Npm.sanitize("@opencode/acme@1.0.0")).toBe("@opencode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/opencode/acme.git"
    const expected = win ? "acme@git+https_//github.com/opencode/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})

describe("Npm.add", () => {
  test("reifies when package cache directory exists without the package installed", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "fixture-provider"))
    await writePackage(path.join(tmp.path, "fixture-provider"), {
      name: "fixture-provider",
      main: "index.js",
    })
    await Bun.write(path.join(tmp.path, "fixture-provider", "index.js"), "export const fixture = true\n")

    const spec = `fixture-provider@file:${path.join(tmp.path, "fixture-provider")}`
    await fs.mkdir(path.join(tmp.path, "cache", "packages", Npm.sanitize(spec)), { recursive: true })

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.entrypoint).toBeDefined()
  })

  // The Desktop sidecar runs the server under Node, where import.meta.resolve cannot take a
  // parent URL. Exercise the real Node branch instead of the Bun one the test runner uses.
  test("resolves an importable file URL under Node", async () => {
    await using tmp = await tmpdir()
    const node = which("node")
    if (!node) throw new Error("Node is required for the Npm Node runtime test")

    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "../src/npm.ts")],
      target: "node",
      format: "esm",
    })
    expect(bundle.success).toBe(true)
    const entry = path.join(tmp.path, "npm.mjs")
    await Bun.write(entry, bundle.outputs[0])

    const dual = path.join(tmp.path, "dual-provider")
    await writePackage(dual, {
      name: "dual-provider",
      exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.js" } },
    })
    await Bun.write(path.join(dual, "dist", "index.mjs"), "export const createDual = () => 'esm'\n")
    await Bun.write(path.join(dual, "dist", "index.js"), "exports.createDual = () => 'cjs'\n")

    const scoped = path.join(tmp.path, "scoped-provider")
    await writePackage(scoped, {
      name: "@fixture/scoped-provider",
      type: "module",
      exports: "./dist/index.js",
    })
    await Bun.write(path.join(scoped, "dist", "index.js"), "export const createScoped = () => 'scoped'\n")

    const proc = Bun.spawn(
      [
        node,
        "--input-type=module",
        "-e",
        `
        import assert from "node:assert/strict"
        import { Npm } from ${JSON.stringify(pathToFileURL(entry).href)}
        assert.equal(typeof Bun, "undefined")
        for (const [spec, name] of [
          [${JSON.stringify(`dual-provider@file:${dual}`)}, "createDual"],
          [${JSON.stringify(`@fixture/scoped-provider@file:${scoped}`)}, "createScoped"],
        ]) {
          const result = await Npm.add(spec)
          assert.ok(result.entrypoint?.startsWith("file://"), "entrypoint is a file URL: " + result.entrypoint)
          const mod = await import(result.entrypoint)
          assert.equal(typeof mod[name], "function", "module exports " + name)
        }
        process.exit(0)
      `,
      ],
      {
        env: { ...process.env, XDG_CACHE_HOME: path.join(tmp.path, "cache") },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(stderr, stdout).toBe("")
    expect(code).toBe(0)
  }, 30_000)
})

// 只实现 `GET /<name>`（packument）和 tarball 下载的本地 registry，
// 让 dist-tag 重新解析这条路径可以完全离线、确定性地测。
async function fixtureRegistry(root: string) {
  const packages = new Map<string, { latest: string; versions: Map<string, { tarball: Buffer; integrity: string }> }>()
  const requests: string[] = []

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      requests.push(url.pathname)

      const download = /^\/([^/]+)\/-\/([^/]+)\.tgz$/.exec(url.pathname)
      if (download) {
        const name = download[1]!
        const version = download[2]!.slice(name.length + 1)
        const file = packages.get(name)?.versions.get(version)
        if (!file) return new Response("not found", { status: 404 })
        return new Response(file.tarball)
      }

      const name = decodeURIComponent(url.pathname.slice(1))
      const entry = packages.get(name)
      if (!entry) return new Response("not found", { status: 404 })
      return Response.json({
        name,
        "dist-tags": { latest: entry.latest },
        versions: Object.fromEntries(
          [...entry.versions].map(([version, file]) => [
            version,
            {
              name,
              version,
              dist: { tarball: `${url.origin}/${name}/-/${name}-${version}.tgz`, integrity: file.integrity },
            },
          ]),
        ),
      })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    async publish(name: string, version: string) {
      const dir = await fs.mkdtemp(path.join(root, "pack-"))
      const pkg = path.join(dir, "package")
      await fs.mkdir(pkg, { recursive: true })
      await Bun.write(path.join(pkg, "package.json"), JSON.stringify({ name, version, main: "index.js" }))
      await Bun.write(path.join(pkg, "index.js"), `export const version = ${JSON.stringify(version)}\n`)
      const tarball = path.join(dir, "out.tgz")
      const proc = Bun.spawn(["tar", "-czf", tarball, "-C", dir, "package"], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      })
      if ((await proc.exited) !== 0) throw new Error(`tar failed: ${await new Response(proc.stderr).text()}`)
      const bytes = Buffer.from(await Bun.file(tarball).arrayBuffer())
      const entry = packages.get(name) ?? { latest: version, versions: new Map() }
      entry.latest = version
      entry.versions.set(version, {
        tarball: bytes,
        integrity: `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`,
      })
      packages.set(name, entry)
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true)
    },
  }
}

describe("Npm.add dist-tag resolution", () => {
  test("re-resolves a dist-tag spec so a newly published version is picked up", async () => {
    await using tmp = await tmpdir()
    await using registry = await fixtureRegistry(tmp.path)
    await registry.publish("fixture-plugin", "1.0.0")

    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@latest"
    const installDir = path.join(cache, "packages", Npm.sanitize(spec))
    await fs.mkdir(installDir, { recursive: true })
    await Bun.write(path.join(installDir, ".npmrc"), `registry=${registry.url}\n`)

    const install = () =>
      Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    const installed = async () =>
      ((await Bun.file(path.join(installDir, "node_modules", "fixture-plugin", "package.json")).json()) as {
        version: string
      }).version

    await install()
    expect(await installed()).toBe("1.0.0")

    await registry.publish("fixture-plugin", "2.0.0")
    await install()
    expect(await installed()).toBe("2.0.0")
  }, 120_000)

  test("keeps a cached pinned version without contacting the registry again", async () => {
    await using tmp = await tmpdir()
    await using registry = await fixtureRegistry(tmp.path)
    await registry.publish("fixture-plugin", "1.0.0")
    await registry.publish("fixture-plugin", "2.0.0")

    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@1.0.0"
    const installDir = path.join(cache, "packages", Npm.sanitize(spec))
    await fs.mkdir(installDir, { recursive: true })
    await Bun.write(path.join(installDir, ".npmrc"), `registry=${registry.url}\n`)

    const install = () =>
      Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    await install()
    const resolved = registry.requests.length
    expect(resolved).toBeGreaterThan(0)

    const entry = await install()
    expect(entry.entrypoint).toBeDefined()
    expect(registry.requests.length).toBe(resolved)
    const version = (
      (await Bun.file(path.join(installDir, "node_modules", "fixture-plugin", "package.json")).json()) as {
        version: string
      }
    ).version
    expect(version).toBe("1.0.0")
  }, 120_000)
})

describe("Npm.add plugin auto-update modes", () => {
  test("auto mode reports the version change after upgrading", async () => {
    await using tmp = await tmpdir()
    await using registry = await fixtureRegistry(tmp.path)
    await registry.publish("fixture-plugin", "1.0.0")
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@latest"
    const installDir = path.join(cache, "packages", Npm.sanitize(spec))
    await fs.mkdir(installDir, { recursive: true })
    await Bun.write(path.join(installDir, ".npmrc"), `registry=${registry.url}\n`)
    const add = () =>
      Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    const first = await add()
    expect(first.version).toBe("1.0.0")
    expect(first.previousVersion).toBeUndefined()

    await registry.publish("fixture-plugin", "2.0.0")
    const next = await add()
    expect(next.version).toBe("2.0.0")
    expect(next.previousVersion).toBe("1.0.0")
  }, 120_000)

  test("notify mode reports a newer version without installing it", async () => {
    await using tmp = await tmpdir()
    await using registry = await fixtureRegistry(tmp.path)
    await registry.publish("fixture-plugin", "1.0.0")
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@latest"
    const installDir = path.join(cache, "packages", Npm.sanitize(spec))
    await fs.mkdir(installDir, { recursive: true })
    await Bun.write(path.join(installDir, ".npmrc"), `registry=${registry.url}\n`)
    const add = (mode?: Npm.AddMode) =>
      Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec, mode ? { mode } : undefined)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    const installed = async () =>
      ((await Bun.file(path.join(installDir, "node_modules", "fixture-plugin", "package.json")).json()) as {
        version: string
      }).version

    await add()
    expect(await installed()).toBe("1.0.0")

    await registry.publish("fixture-plugin", "2.0.0")
    const before = registry.requests.length
    const check = await add("notify")

    expect(check.version).toBe("1.0.0")
    expect(check.latest).toBe("2.0.0")
    expect(await installed()).toBe("1.0.0")
    expect(registry.requests.length).toBeGreaterThan(before)
  }, 120_000)

  test("off mode keeps the cached version and never queries the registry", async () => {
    await using tmp = await tmpdir()
    await using registry = await fixtureRegistry(tmp.path)
    await registry.publish("fixture-plugin", "1.0.0")
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@latest"
    const installDir = path.join(cache, "packages", Npm.sanitize(spec))
    await fs.mkdir(installDir, { recursive: true })
    await Bun.write(path.join(installDir, ".npmrc"), `registry=${registry.url}\n`)
    const add = (mode?: Npm.AddMode) =>
      Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec, mode ? { mode } : undefined)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    await add()
    await registry.publish("fixture-plugin", "2.0.0")
    const before = registry.requests.length
    const kept = await add("off")

    expect(kept.version).toBe("1.0.0")
    expect(kept.latest).toBeUndefined()
    expect(registry.requests.length).toBe(before)
  }, 120_000)
})

describe("Npm.install", () => {
  test("respects omit from project .npmrc", async () => {
    await using tmp = await tmpdir()

    await writePackage(tmp.path, {
      name: "fixture",
      dependencies: {
        "prod-pkg": "file:./prod-pkg",
      },
      devDependencies: {
        "dev-pkg": "file:./dev-pkg",
      },
    })
    await Bun.write(path.join(tmp.path, ".npmrc"), "omit=dev\n")
    await fs.mkdir(path.join(tmp.path, "prod-pkg"))
    await fs.mkdir(path.join(tmp.path, "dev-pkg"))
    await writePackage(path.join(tmp.path, "prod-pkg"), { name: "prod-pkg" })
    await writePackage(path.join(tmp.path, "dev-pkg"), { name: "dev-pkg" })

    await Npm.install(tmp.path)

    await expect(fs.stat(path.join(tmp.path, "node_modules", "prod-pkg"))).resolves.toBeDefined()
    await expect(fs.stat(path.join(tmp.path, "node_modules", "dev-pkg"))).rejects.toThrow()
  })
})
