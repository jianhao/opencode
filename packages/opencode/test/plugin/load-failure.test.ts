import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Logger } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

const systemHook = "experimental.chat.system.transform"

const pluginSource = [
  "export default async () => ({",
  `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
  '    output.system.push("loaded")',
  "  },",
  "})",
].join("\n")

// 声明一个 file 插件，先不创建对应文件，模拟「启动时加载失败」。
// `it.instance` 用的是真实时钟，所以重试退避通过环境变量调小。
function withProjectFile(source: string | undefined, self: Effect.Effect<any, any, any>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    yield* Effect.promise(() =>
      Bun.write(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["./plugin.ts"] }, null, 2),
      ),
    )
    if (source !== undefined) yield* Effect.promise(() => Bun.write(path.join(test.directory, "plugin.ts"), source))
    return yield* self
  })
}

function withRetryBase<E, R>(ms: number, self: Effect.Effect<void, E, R>) {
  const previous = process.env["OPENCODE_PLUGIN_RETRY_BASE_MS"]
  process.env["OPENCODE_PLUGIN_RETRY_BASE_MS"] = String(ms)
  return self.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (previous === undefined) delete process.env["OPENCODE_PLUGIN_RETRY_BASE_MS"]
        else process.env["OPENCODE_PLUGIN_RETRY_BASE_MS"] = previous
      }),
    ),
  )
}

function collectLogs<A, E, R>(self: Effect.Effect<A, E, R>) {
  const messages: unknown[] = []
  return self
    .pipe(
      Effect.provide(
        Logger.layer([
          Logger.make<unknown, void>((options) => {
            messages.push(options.message)
          }),
        ]),
      ),
    )
    .pipe(Effect.map((value) => ({ value, messages: JSON.stringify(messages) })))
}

describe("plugin load failures", () => {
  it.instance("logs the failure instead of dropping the plugin silently", () =>
    withProjectFile(
      undefined,
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const { value, messages } = yield* collectLogs(plugin.list())

        expect(value).toHaveLength(0)
        expect(messages).toContain("failed to load plugin")
        expect(messages).toContain("plugin.ts")
      }),
    ),
  )

  it.instance("recovers once the plugin becomes loadable, without restarting", () =>
    withRetryBase(
      50,
      withProjectFile(
        undefined,
        Effect.gen(function* () {
          const test = yield* TestInstance
          const plugin = yield* Plugin.Service

          // 首次加载失败，实例会被缓存成「没有插件」
          expect(yield* plugin.list()).toHaveLength(0)

          // 插件文件出现（用户补装、网络恢复都走同一条路径）
          yield* Effect.promise(() => Bun.write(path.join(test.directory, "plugin.ts"), pluginSource))

          // 冷却时间到之前不重试
          expect(yield* plugin.list()).toHaveLength(0)

          // 冷却时间到之后，下一次访问触发重新加载
          yield* Effect.sleep("400 millis")
          const hooks = yield* plugin.list()
          expect(hooks).toHaveLength(1)
          expect(hooks[0][systemHook]).toBeFunction()
        }),
      ),
    ),
  )
})
