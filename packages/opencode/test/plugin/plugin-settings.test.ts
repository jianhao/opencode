import { afterEach, beforeEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
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

const globalConfig = path.join(Global.Path.config, "opencode.json")
const globalPlugin = path.join(Global.Path.config, "settings-probe.ts")

// plugin_settings 只能写在全局配置里，所以这里直接往（测试隔离的）全局配置目录里写。
const writeGlobal = async (settings?: Record<string, unknown>) => {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Bun.write(globalPlugin, pluginSource)
  await Bun.write(
    globalConfig,
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: ["./settings-probe.ts"],
        ...(settings ? { plugin_settings: settings } : {}),
      },
      null,
      2,
    ),
  )
}

const cleanGlobal = () =>
  Promise.all([globalConfig, globalPlugin].map((file) => fs.rm(file, { force: true }))).then(() => undefined)

beforeEach(cleanGlobal)
afterEach(cleanGlobal)

const hooks = () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    return yield* plugin.list()
  })

describe("plugin_settings for file plugins", () => {
  it.instance("disables a plugin whose settings key is written like the plugin entry", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeGlobal({ "./settings-probe.ts": { enabled: false } }))
      expect(yield* hooks()).toHaveLength(0)
    }),
  )

  it.instance("keeps the plugin when the setting enables it", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeGlobal({ "./settings-probe.ts": { enabled: true } }))
      const list = yield* hooks()
      expect(list).toHaveLength(1)
      expect(list[0][systemHook]).toBeFunction()
    }),
  )

  it.instance("keeps the plugin when there are no settings", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeGlobal())
      expect(yield* hooks()).toHaveLength(1)
    }),
  )
})
