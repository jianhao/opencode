import { existsSync, readFileSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

export const DEFAULT_ENV_FILE = path.join(Global.Path.config, ".env")

export function loadEnvFile(file = DEFAULT_ENV_FILE) {
  if (!existsSync(file)) return

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const entry = line.trim().replace(/^export\s+/, "")
    if (!entry || entry.startsWith("#")) continue

    const separator = entry.indexOf("=")
    if (separator <= 0) continue

    const key = entry.slice(0, separator).trim()
    // Bun reports `HTTP(S)_PROXY in process.env` as true even when the variable
    // is unset, so test the value itself to decide whether to skip it.
    if (!key || process.env[key] !== undefined) continue

    process.env[key] = unquote(entry.slice(separator + 1).trim())
  }
}

function unquote(value: string) {
  const quote = value.at(0)
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return value
  return value.slice(1, -1)
}

export * as EnvFile from "./env-file"
