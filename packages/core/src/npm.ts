export * as Npm from "./npm"

import path from "path"
import { createRequire } from "module"
import { pathToFileURL } from "url"
import npa from "npm-package-arg"
import semver from "semver"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { EffectFlock } from "./util/effect-flock"
import { makeGlobalNode } from "./effect/app-node"
import { filesystem } from "./effect/app-node-platform"
import { LayerNode } from "./effect/layer-node"
import { makeRuntime } from "./effect/runtime"
import { NpmConfig } from "./npm-config"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint?: string
}

// how to treat a spec whose resolved version can change over time (dist-tag / bare name):
// - "auto": re-resolve and install the latest version every time (default)
// - "notify": only look up the latest version, never write; report it via `latest`
// - "off": keep whatever is cached and never touch the registry
export type AddMode = "auto" | "notify" | "off"

export interface AddOptions {
  readonly mode?: AddMode
  // Ignore the cached copy and always re-resolve, even for pinned/stable specs.
  readonly force?: boolean
}

export interface AddResult extends EntryPoint {
  readonly version?: string
  readonly previousVersion?: string
  readonly latest?: string
}

export interface Interface {
  readonly add: (
    pkg: string,
    options?: AddOptions,
  ) => Effect.Effect<AddResult, InstallFailedError | EffectFlock.LockError>
  readonly install: (
    dir: string,
    input?: {
      add: {
        name: string
        version?: string
      }[]
    },
  ) => Effect.Effect<void, EffectFlock.LockError | InstallFailedError>
  readonly which: (pkg: string, bin?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

type ParsedSpec = {
  name: string | null | undefined
  type: string
  fetchSpec: string
}

function parseSpec(spec: string): ParsedSpec | undefined {
  try {
    const parsed = npa(spec)
    return { name: parsed.name, type: parsed.type, fetchSpec: String(parsed.fetchSpec) }
  } catch {
    return undefined
  }
}

// dist-tag 规格（`foo@latest` / `foo@next`）和裸包名（等价于 `foo@latest`）指向的是
// 一个会随时间变化的版本，必须每次都重新解析。只按缓存目录是否存在来短路，
// 会导致用户发布了新版本但客户端永远拿不到（upstream#25293）。
function resolveEveryTime(parsed: ParsedSpec | undefined) {
  if (!parsed) return false
  if (parsed.type === "tag") return true
  return parsed.type === "range" && parsed.fetchSpec === "*"
}

const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
  let entrypoint: string | undefined
  try {
    // Node only honors the parent argument behind --experimental-import-meta-resolve, and
    // import() of the bare package directory fails with ERR_UNSUPPORTED_DIR_IMPORT. require
    // resolution picks the "require"/"default" export target, which import() loads fine.
    entrypoint =
      typeof Bun !== "undefined"
        ? import.meta.resolve(name, dir)
        : pathToFileURL(createRequire(path.join(dir, "package.json")).resolve(name)).href
  } catch {
    entrypoint = undefined
  }
  return {
    directory: dir,
    entrypoint,
  }
}

interface ArboristNode {
  name: string
  path: string
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
    const reify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* NpmConfig.load(input.dir)
        const arborist = new Arborist({
          ...npmOptions,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...npmOptions,
              add,
              save: true,
              saveType: "prod",
            }),
          catch: (cause) =>
            new InstallFailedError({
              cause,
              add,
              dir: input.dir,
            }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )

    // 读取某个已安装包目录的版本（用于判断一次重新解析是否真的升级了版本）。
    const installedVersion = (dir: string) =>
      afs.readJson(path.join(dir, "package.json")).pipe(
        Effect.map((json) => json as { version?: unknown }),
        Effect.map((json) => (typeof json?.version === "string" ? json.version : undefined)),
        Effect.orElseSucceed(() => undefined),
      )

    // 只查询 registry 上的最新版本（dist-tags.latest），不下载、不写盘。
    const latestVersion = (name: string, dir: string) =>
      Effect.gen(function* () {
        const registry = yield* NpmConfig.registry(dir)
        const url = `${registry}/${name.replace("/", "%2f")}`
        const json = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } })
            if (!res.ok) throw new Error(`registry ${url} responded ${res.status}`)
            return (await res.json()) as { "dist-tags"?: { latest?: string } }
          },
          catch: (cause) => cause,
        })
        const latest = json?.["dist-tags"]?.latest
        return typeof latest === "string" ? latest : undefined
      })

    const add = Effect.fn("Npm.add")(function* (pkg: string, options?: AddOptions) {
      const mode = options?.mode ?? "auto"
      const dir = directory(pkg)
      const parsed = parseSpec(pkg)
      const name = parsed?.name ?? pkg
      const cached = path.join(dir, "node_modules", name)
      const installed = yield* afs.existsSafe(cached)
      const previousVersion = installed ? yield* installedVersion(cached) : undefined
      const reusable = (): AddResult => ({
        ...resolveEntryPoint(name, cached),
        version: previousVersion,
        previousVersion,
      })

      // 固定版本、range、本地路径、git/url 这类规格解析结果是稳定的，装过就能直接复用。
      // "off" 模式下，即使是不稳定的 dist-tag 也直接用缓存，完全不碰 registry。
      const unstable = resolveEveryTime(parsed)
      if (installed && !options?.force && (!unstable || mode === "off")) return reusable()

      // "notify" 只查最新版、不写盘；有更新就把 latest 报给调用方，由用户决定是否更新。
      if (installed && !options?.force && mode === "notify") {
        const latest = yield* latestVersion(name, dir).pipe(
          Effect.tapError((error) => Effect.logWarning("failed to check plugin version", { pkg, error: String(error) })),
          Effect.orElseSucceed(() => undefined),
        )
        const newer =
          latest !== undefined &&
          previousVersion !== undefined &&
          semver.valid(latest) !== null &&
          semver.valid(previousVersion) !== null &&
          semver.gt(latest, previousVersion)
        if (newer && latest) return { ...reusable(), latest }
        return reusable()
      }

      const tree = yield* reify({ dir, add: [pkg] }).pipe(
        // 重新解析 dist-tag 需要联网。离线时不要把一个本来可用的缓存插件变成不可用，
        // 因此这里退回已安装的副本，并明确记录原因（而不是静默降级）。
        Effect.catchTag("NpmInstallFailedError", (error) =>
          installed
            ? Effect.logWarning("npm registry unreachable, using cached plugin install", {
                pkg,
                dir,
                error: error.message,
              }).pipe(Effect.as(undefined))
            : Effect.fail(error),
        ),
      )
      if (!tree) return reusable()

      const first = tree.edgesOut.values().next().value?.to
      if (!first) {
        const result = resolveEntryPoint(name, cached)
        if (result.entrypoint) return { ...result, version: previousVersion, previousVersion }
        return yield* new InstallFailedError({ add: [pkg], dir })
      }
      return {
        ...resolveEntryPoint(first.name, first.path),
        version: yield* installedVersion(first.path),
        previousVersion,
      }
    }, Effect.scoped)

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map((pkg) => [pkg.name, pkg.version].filter(Boolean).join("@")) ?? []
      if (
        yield* Effect.gen(function* () {
          const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules"))
          if (!nodeModulesExists) {
            yield* reify({ add, dir })
            return true
          }
          return false
        }).pipe(Effect.withSpan("Npm.checkNodeModules"))
      )
        return

      yield* Effect.gen(function* () {
        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        const pkgAny = pkg as any
        const lockAny = lock as any
        const declared = new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
          ...(input?.add || []).map((pkg) => pkg.name),
        ])

        const root = lockAny?.packages?.[""] || {}
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {}),
        ])

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify({ dir, add })
            return
          }
        }
      }).pipe(Effect.withSpan("Npm.checkDirty"))

      return
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      const dir = directory(pkg)
      const binDir = path.join(dir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

        if (files.length === 0) return Option.none<string>()
        // Caller picked a specific bin (e.g. pyright exposes both `pyright` and
        // `pyright-langserver`); trust the hint if the package provides it.
        if (bin) return files.includes(bin) ? Option.some(bin) : Option.none<string>()
        if (files.length === 1) return Option.some(files[0])

        const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", pkg, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
            const parsedBin = parsed.bin
            if (typeof parsedBin === "string") return Option.some(unscoped)
            const keys = Object.keys(parsedBin)
            if (keys.length === 1) return Option.some(keys[0])
            return parsedBin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
          }
        }

        return Option.some(files[0])
      })

      return Option.getOrUndefined(
        yield* Effect.gen(function* () {
          const bin = yield* pick()
          if (Option.isSome(bin)) {
            return Option.some(path.join(binDir, bin.value))
          }

          yield* fs.remove(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => {}))

          yield* add(pkg)

          const resolved = yield* pick()
          if (Option.isNone(resolved)) return Option.none<string>()
          return Option.some(path.join(binDir, resolved.value))
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      )
    })

    return Service.of({
      add,
      install,
      which,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Global.node, filesystem, EffectFlock.node],
})

const { runPromise } = makeRuntime(Service, LayerNode.compile(node))

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>) {
  return runPromise((svc) => svc.add(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  return runPromise((svc) => svc.which(...args))
}
