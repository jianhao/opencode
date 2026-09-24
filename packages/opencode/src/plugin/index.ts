import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import type {
  Hooks,
  PluginInput,
  Plugin as PluginInstance,
  PluginModule,
  WorkspaceAdapter as PluginWorkspaceAdapter,
} from "@opencode-ai/plugin"
import { Config } from "@/config/config"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./openai/codex"
import { Session } from "@/session/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { ModalPlugin } from "./modal/modal"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"
import { CerebrasPlugin } from "./cerebras"
import { SnowflakeCortexAuthPlugin } from "./snowflake-cortex"
import { Clock, Effect, Layer, Context } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import {
  forceUpdatePluginTarget,
  parsePluginSpecifier,
  readPluginId,
  readV1Plugin,
  resolvePluginId,
} from "./shared"
import { pluginSpecifier } from "@/config/plugin"
import { registerAdapter } from "@/control-plane/adapters"
import type { WorkspaceAdapter } from "@/control-plane/types"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Npm } from "@opencode-ai/core/npm"
import { Plugin as PluginEvents } from "@opencode-ai/schema/plugin"

type State = {
  hooks: Hooks[]
}

type LoadFailure = {
  spec: string
  stage: "install" | "entry" | "compatibility" | "load" | "missing"
  message: string
}

// 插件加载失败后允许重新尝试的退避：15s、30s、60s…最多 5 分钟。
// 加载结果会被 InstanceState 按目录缓存，失败如果只缓存不重试，
// 这个实例就会永久失去插件工具，只能重启 app（见 upstream#41574）。
const RETRY_MAX_MS = 300_000
const RETRY_DEFAULT_BASE_MS = 15_000

function retryBaseMs() {
  const value = Number(Flag.OPENCODE_PLUGIN_RETRY_BASE_MS)
  return Number.isFinite(value) && value > 0 ? value : RETRY_DEFAULT_BASE_MS
}

function retryDelay(attempts: number) {
  return Math.min(retryBaseMs() * 2 ** (attempts - 1), RETRY_MAX_MS)
}

function failureMessage(failure: LoadFailure) {
  if (failure.stage === "install") {
    const parsed = parsePluginSpecifier(failure.spec)
    return `Failed to install plugin ${parsed.pkg}@${parsed.version}: ${failure.message}`
  }
  if (failure.stage === "compatibility" || failure.stage === "missing") {
    return `Plugin ${failure.spec} skipped: ${failure.message}`
  }
  return `Failed to load plugin ${failure.spec}: ${failure.message}`
}

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly init: () => Effect.Effect<void>
  // Force an unpinned npm plugin to re-resolve to the latest version and reload it.
  readonly update: (spec: string) => Effect.Effect<{ readonly version?: string }, string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

export function experimentalWebSocketsEnabled(input: { enabled: boolean; channel?: string }) {
  return input.enabled || ["local", "dev", "beta"].includes(input.channel ?? InstallationChannel)
}

// Built-in plugins that are directly imported (not installed from npm)
function internalPlugins(flags: RuntimeFlags.Info): PluginInstance[] {
  return [
    // Temporary rollout: pre-release builds use WebSockets by default; releases require explicit opt-in.
    (input) =>
      CodexAuthPlugin(input, {
        experimentalWebSockets: experimentalWebSocketsEnabled({ enabled: flags.experimentalWebSockets }),
      }),
    CopilotAuthPlugin,
    ModalPlugin,
    GitlabAuthPlugin,
    PoeAuthPlugin,
    CloudflareWorkersAuthPlugin,
    CloudflareAIGatewayAuthPlugin,
    AzureAuthPlugin,
    DigitalOceanAuthPlugin,
    SnowflakeCortexAuthPlugin,
    XaiAuthPlugin,
    CerebrasPlugin,
  ]
}

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput, hooks: Hooks[]) {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
    hooks.push(await (plugin as PluginModule).server(input, load.options))
    return
  }

  for (const server of getLegacyPlugins(load.mod)) {
    hooks.push(await server(input, load.options))
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service

    // 按目录记住上一次加载失败和下一次允许重试的时间点
    const retry = new Map<string, { attempts: number; next: number }>()
    // 按目录记住构建当前插件状态时的配置签名。配置变化后下次访问即失效重载，
    // 这样插件设置的改动可以轻量生效，而不必销毁整个实例。
    const signatures = new Map<string, string>()

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const hooks: Hooks[] = []
        const bridge = yield* EffectBridge.make()
        const failures: LoadFailure[] = []

        function publishPluginError(message: string) {
          bridge.fork(events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))

        const serverUrl = Server.url
        const client = createOpencodeClient({
          baseUrl: serverUrl?.toString() ?? "http://localhost:4096",
          directory: ctx.directory,
          headers: ServerAuth.headers(),
          ...(serverUrl ? {} : { fetch: async (...args) => Server.Default().app.fetch(...args) }),
        })
        const cfg = yield* config.get()
        // 插件设置/更新策略写的是全局配置，且全局配置缓存在 config.updateGlobal 时会被失效。
        // 实例级 config.get() 只有 dispose 实例才会刷新，这里改用全局缓存以便改动能轻量生效。
        const globalCfg = yield* config.getGlobal()
        const input: PluginInput = {
          client,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          experimental_workspace: {
            register(type: string, adapter: PluginWorkspaceAdapter) {
              registerAdapter(ctx.project.id, type, adapter as WorkspaceAdapter)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const plugin of flags.disableDefaultPlugins ? [] : internalPlugins(flags)) {
          const init = yield* Effect.tryPromise({
            try: () => plugin(input),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("failed to load internal plugin", { name: plugin.name, error })),
            Effect.option,
          )
          if (init._tag === "Some") hooks.push(init.value)
        }

        const allPlugins = flags.pure ? [] : (cfg.plugin_origins ?? [])
        if (flags.pure && cfg.plugin_origins?.length) {
        }
        // 每个插件可以在 plugin_settings 里单独启用/停用、覆盖更新策略；缺省回落到全局 plugin_autoupdate。
        const pluginSettings = globalCfg.plugin_settings ?? {}
        const plugins = allPlugins.filter((origin) => pluginSettings[pluginSpecifier(origin.spec)]?.enabled !== false)
        if (plugins.length) yield* config.waitForDependencies()

        const autoUpdate = globalCfg.plugin_autoupdate
        const mode: Npm.AddMode = autoUpdate === "notify" ? "notify" : autoUpdate === false ? "off" : "auto"
        const modeFor = (spec: string): Npm.AddMode => {
          const value = pluginSettings[spec]?.autoupdate
          if (value === true) return "auto"
          if (value === false) return "off"
          if (value === "notify") return "notify"
          return mode
        }

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            mode,
            modeFor,
            report: {
              start(candidate) {},
              missing(candidate, _retry, message) {
                failures.push({ spec: candidate.plan.spec, stage: "missing", message })
              },
              error(candidate, _retry, stage, error) {
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)
                failures.push({ spec: candidate.plan.spec, stage, message })
              },
            },
          }),
        )
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          yield* Effect.tryPromise({
            try: () => applyPlugin(load, input, hooks),
            catch: (err) => {
              const message = errorMessage(err)
              return message
            },
          }).pipe(
            Effect.catch((message) =>
              Effect.sync(() => {
                failures.push({ spec: load.spec, stage: "load", message })
              }),
            ),
          )
        }

        // 版本变化/有新版本的提示：只针对成功加载的插件。
        // - auto：重新解析后版本变了 → plugin.updated（已更新到 vY）
        // - notify：查到了更新的版本但不安装 → plugin.update_available（有新版 vY，可点更新）
        for (const load of loaded) {
          if (!load) continue
          // notify 模式只查询不安装，latest 才会被设置；auto 模式安装后版本可能变化。
          if (load.latest && load.version && load.version !== load.latest) {
            bridge.fork(
              events.publish(PluginEvents.Event.UpdateAvailable, {
                spec: load.spec,
                current: load.version,
                latest: load.latest,
              }),
            )
            continue
          }
          if (load.version && load.previousVersion && load.version !== load.previousVersion) {
            bridge.fork(
              events.publish(PluginEvents.Event.Updated, {
                spec: load.spec,
                from: load.previousVersion,
                to: load.version,
              }),
            )
          }
        }

        // 之前这里只 publish 一个事件：opencode.log 里什么都没有，用户也无从排查。
        // 现在既写日志（可诊断），也推到会话错误里（用户可见）。
        for (const failure of failures) {
          yield* Effect.logError("failed to load plugin", failure)
          publishPluginError(failureMessage(failure))
        }

        // 把失败记录下来，冷却结束后由下一次访问触发重新加载
        if (failures.length > 0) {
          const attempts = (retry.get(ctx.directory)?.attempts ?? 0) + 1
          yield* Effect.logInfo("plugin load failed, will retry later", {
            directory: ctx.directory,
            attempts,
            retryInMs: retryDelay(attempts),
            specs: failures.map((failure) => failure.spec),
          })
          retry.set(ctx.directory, { attempts, next: (yield* Clock.currentTimeMillis) + retryDelay(attempts) })
        } else {
          retry.delete(ctx.directory)
        }

        // Notify plugins of current config
        for (const hook of hooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((hook as any).config?.(cfg)),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("plugin config hook failed", { error })),
            Effect.ignore,
          )
        }

        const unsubscribe = yield* events.listen((event) => {
          if (event.location?.directory !== ctx.directory) return Effect.void
          return Effect.sync(() => {
            for (const hook of hooks) {
              void hook["event"]?.({ event: { id: event.id, type: event.type, properties: event.data } as any })
            }
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        yield* Effect.addFinalizer(() =>
          Effect.forEach(
            hooks,
            (hook) =>
              Effect.tryPromise({
                try: () => Promise.resolve(hook.dispose?.()),
                catch: errorMessage,
              }).pipe(
                Effect.tapError((error) => Effect.logError("plugin dispose hook failed", { error })),
                Effect.ignore,
              ),
            { discard: true },
          ),
        )

        return { hooks }
      }),
    )

    // 失败结果会被 InstanceState 按目录缓存。冷却到点后先让它失效，再重新加载，
    // 这样新会话有机会自动恢复，而不是必须重启 app。
    const loadState = Effect.gen(function* () {
      const directory = yield* InstanceState.directory
      const pending = retry.get(directory)
      if (pending && (yield* Clock.currentTimeMillis) >= pending.next) {
        yield* Effect.logInfo("retrying plugin load", { directory, attempts: pending.attempts })
        yield* InstanceState.invalidate(state)
      }

      // 影响插件加载的配置（插件列表 / 每插件设置 / 全局更新策略）变了就失效缓存，
      // 下次访问即用新设置重载。轻量：不销毁实例、不影响其它进行中的请求。
      const current = yield* config.get()
      const globalCfg = yield* config.getGlobal()
      const signature = JSON.stringify({
        plugins: (current.plugin_origins ?? []).map((origin) => pluginSpecifier(origin.spec)),
        settings: globalCfg.plugin_settings ?? {},
        autoupdate: globalCfg.plugin_autoupdate ?? null,
      })
      const known = signatures.get(directory)
      if (known !== undefined && known !== signature) {
        yield* Effect.logInfo("plugin settings changed, reloading", { directory })
        yield* InstanceState.invalidate(state)
      }
      signatures.set(directory, signature)
      return yield* InstanceState.get(state)
    })

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* loadState
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* loadState
      return s.hooks
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* loadState
    })

    // 显式更新：强制重新解析到最新版，然后让按目录缓存失效，下次访问重新加载插件。
    const update = Effect.fn("Plugin.update")(function* (spec: string) {
      const result = yield* Effect.tryPromise({
        try: () => forceUpdatePluginTarget(spec),
        catch: (error) => errorMessage(error),
      })
      yield* Effect.logInfo("plugin updated", { spec, version: result.version })
      yield* InstanceState.invalidate(state)
      return { version: result.version }
    })

    return Service.of({ trigger, list, init, update })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Config.node, RuntimeFlags.node],
})

export * as Plugin from "."
