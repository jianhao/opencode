import { app, safeStorage } from "electron"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Token and settings for the workbench.
 *
 * A pasted token is encrypted with the OS keyring through safeStorage. The environment (including
 * the shell profile, because Finder-launched apps do not inherit .zshrc) is a read-only source that
 * is never written back, so the same machine keeps working without storing a secret twice.
 */

export const NAMESPACE = "workbench"
const TOKEN_FILE = ["workbench", "token.bin"] as const

export type Settings = {
  frontendServerUrl: string
  organizationId: string | undefined
}

export type Token = { value: string; source: "env" | "stored" } | { value: undefined; source: "none" }

export const DEFAULT_SERVER_URL = "http://192.168.199.82:9522"

export function readSettings(state: { get(name: string, key: string): string | null }): Settings {
  return {
    // The team frontend-server runs on the 82 box; a saved value wins so a local instance still works.
    frontendServerUrl: state.get(NAMESPACE, "frontendServerUrl") ?? readEnv("WORKBENCH_SERVER_URL") ?? DEFAULT_SERVER_URL,
    organizationId: state.get(NAMESPACE, "organizationId") ?? undefined,
  }
}

export function writeSettings(
  state: { set(name: string, key: string, value: string): void },
  input: { frontendServerUrl: string; organizationId: string | undefined },
) {
  state.set(NAMESPACE, "frontendServerUrl", input.frontendServerUrl)
  if (input.organizationId) state.set(NAMESPACE, "organizationId", input.organizationId)
}

export function path() {
  return join(app.getPath("userData"), ...TOKEN_FILE)
}

// Without a keyring a pasted token lives for this process only: writing a secret in plain text is
// worse than asking again next launch.
let memoryToken: string | undefined

export function readStored(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return memoryToken

  const file = path()
  if (!existsSync(file)) return undefined

  try {
    return safeStorage.decryptString(readFileSync(file))
  } catch {
    return undefined
  }
}

export function writeStored(token: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    memoryToken = token
    return
  }

  const file = path()
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, safeStorage.encryptString(token))
}

export function clearStored() {
  memoryToken = undefined
  if (existsSync(path())) rmSync(path())
}

export function canStore() {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Reads a token from the process environment, then from the shell profile. Login shells export it
 * in .zshrc, but a packaged app launched from Finder sees neither, so the profile is the fallback.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  if (value) return value

  for (const profile of [".zshrc", ".zprofile", ".zshenv", ".bash_profile", ".bashrc"]) {
    const file = join(homedir(), profile)
    if (!existsSync(file)) continue

    const match = readFileSync(file, "utf8").match(new RegExp(`^\\s*export\\s+${name}=(?:"([^"]*)"|'([^']*)'|(\\S+))`, "m"))
    const found = match?.[1] ?? match?.[2] ?? match?.[3]
    if (found?.trim()) return found.trim()
  }

  return undefined
}

export function resolveToken(): Token {
  const stored = readStored()
  if (stored) return { value: stored, source: "stored" }

  const env = readEnv("YUNXIAO_ACCESS_TOKEN")
  if (env) return { value: env, source: "env" }

  return { value: undefined, source: "none" }
}

export function resolveOrganizationId(settings: Settings): string | undefined {
  return settings.organizationId ?? readEnv("YUNXIAO_ORGANIZATION_ID")
}
