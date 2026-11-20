import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const DEV_SERVICE_PORT = 3084

const DEV_APP_ID = "ai.opencode.desktop.dev"

export type DevServiceListener = {
  readonly pid: number
  readonly ppid: number
  readonly command: string
}

export type DevProcess = {
  readonly pid: number
  readonly command: string
}

type DevServiceRegistration = {
  readonly pid?: number
  readonly url?: unknown
}

// 只认当前仓库的 dev CLI，路径边界用于排除同级前缀目录中的其他仓库。
function isOwnedSidecar(listener: DevServiceListener, repositoryRoot: string) {
  const command = listener.command.replaceAll("\\", "/")
  const cliDirectory = join(repositoryRoot, "packages/cli").replaceAll("\\", "/")
  const cli = command.indexOf(cliDirectory)
  const cliEnd = command[cli + cliDirectory.length]

  return (
    cli !== -1 &&
    (cliEnd === undefined || /[\s/"']/.test(cliEnd)) &&
    command.includes("serve --service") &&
    new RegExp(`(?:^|\\s)--port\\s+${DEV_SERVICE_PORT}(?:\\s|$)`).test(command)
  )
}

// 只回收当前仓库 dev 启动器留下的孤儿服务，避免误伤其他应用或仍在使用的开发实例。
export function selectOrphanedSidecars(listeners: readonly DevServiceListener[], repositoryRoot: string) {
  if (listeners.length === 0) return []

  const blocked = listeners.filter(
    (listener) => listener.ppid !== 1 || !isOwnedSidecar(listener, repositoryRoot),
  )

  if (blocked.length > 0) {
    const owner = blocked
      .map((listener) => `PID ${listener.pid}: ${listener.command.trim()}`)
      .join("\n")

    throw new Error(
      `Port ${DEV_SERVICE_PORT} is already in use. Close the owning process before starting the desktop dev app.\n${owner}`,
    )
  }

  return listeners.map((listener) => listener.pid)
}

export function selectOwnedSidecars(listeners: readonly DevServiceListener[], repositoryRoot: string) {
  return listeners.filter((listener) => isOwnedSidecar(listener, repositoryRoot))
}

export function selectDevDesktopPids(
  listeners: readonly DevServiceListener[],
  processes: readonly DevProcess[],
  repositoryRoot: string,
) {
  const commands = new Map(processes.map((process) => [process.pid, process.command.replaceAll("\\", "/")]))
  const appRoot = join(repositoryRoot, "packages/desktop/node_modules/.cache/opencode-dev").replaceAll("\\", "/")

  return [
    ...new Set(
      selectOwnedSidecars(listeners, repositoryRoot)
        .filter((listener) => listener.ppid !== 1)
        .flatMap((listener) => {
          const command = commands.get(listener.ppid)

          return command?.includes(appRoot) && command.includes("/OpenCode Dev.app/Contents/MacOS/Electron")
            ? [listener.ppid]
            : []
        }),
    ),
  ]
}

export async function reclaimDevServicePort(repositoryRoot: string) {
  await removeStaleDevServiceRegistration()

  if (process.platform === "win32" || !Bun.which("lsof")) return

  const listeners = readDevServiceListeners()
  const orphaned = selectOrphanedSidecars(listeners, repositoryRoot)

  for (const pid of orphaned) {
    Bun.spawnSync(["kill", "-TERM", String(pid)], { stdout: "ignore", stderr: "ignore" })

    if (!(await waitForExit(pid, 3_000))) {
      Bun.spawnSync(["kill", "-KILL", String(pid)], { stdout: "ignore", stderr: "ignore" })

      if (!(await waitForExit(pid, 1_000)))
        throw new Error(`Orphaned desktop dev sidecar PID ${pid} did not exit`)
    }

    console.log(`Reclaimed orphaned desktop dev sidecar PID ${pid} on port ${DEV_SERVICE_PORT}`)
  }
}

// 手动停止会先关闭当前仓库的 dev App，让桌面端自行退出；随后清理它留下的服务。
export async function stopDevDesktop(repositoryRoot: string) {
  await removeStaleDevServiceRegistration()

  if (process.platform === "win32" || !Bun.which("lsof")) return

  const listeners = readDevServiceListeners()

  if (listeners.length === 0) return

  const owned = selectOwnedSidecars(listeners, repositoryRoot)

  if (owned.length !== listeners.length) {
    const owner = listeners
      .filter((listener) => !owned.includes(listener))
      .map((listener) => `PID ${listener.pid}: ${listener.command.trim()}`)
      .join("\n")

    throw new Error(`Port ${DEV_SERVICE_PORT} belongs to another process and was not stopped.\n${owner}`)
  }

  const activePids = [...new Set(owned.filter((listener) => listener.ppid !== 1).map((listener) => listener.ppid))]

  const processes = activePids.flatMap((pid) => {
    const command = processOutput(["ps", "-o", "command=", "-p", String(pid)])

    return command ? [{ pid, command }] : []
  })

  const desktopPids = selectDevDesktopPids(owned, processes, repositoryRoot)

  if (desktopPids.length !== activePids.length) {
    const owner = owned
      .filter((listener) => listener.ppid !== 1)
      .map((listener) => `PID ${listener.pid}, parent ${listener.ppid}: ${listener.command.trim()}`)
      .join("\n")

    throw new Error(`The dev service is owned by an active process. Close OpenCode Dev, then retry.\n${owner}`)
  }

  for (const pid of desktopPids) {
    Bun.spawnSync(["kill", "-TERM", String(pid)], { stdout: "ignore", stderr: "ignore" })

    if (!(await waitForExit(pid, 10_000))) throw new Error(`Desktop dev app PID ${pid} did not exit`)
  }

  await reclaimDevServicePort(repositoryRoot)
}

export async function removeStaleDevServiceRegistration(file = devServiceRegistrationPath()) {
  if (!file) return false

  const text = await Bun.file(file)
    .text()
    .catch(() => undefined)

  if (!text) return false

  let registration: DevServiceRegistration

  try {
    // SAFETY: 文件来自 dev 服务自身的受控注册目录，后续只读取可选的 pid 和 url。
    registration = JSON.parse(text) as DevServiceRegistration
  } catch {
    return false
  }

  if (
    registration.url !== `http://0.0.0.0:${DEV_SERVICE_PORT}` &&
    registration.url !== `http://127.0.0.1:${DEV_SERVICE_PORT}`
  )
    return false

  if (registration.pid !== undefined && isRunning(registration.pid)) return false

  await rm(file, { force: true })
  console.log(`Removed stale desktop dev service registration ${file}`)

  return true
}

function devServiceRegistrationPath() {
  const appData = appDataPath()

  return appData ? join(appData, DEV_APP_ID, "opencode", "service-local.json") : undefined
}

function appDataPath() {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support")

  if (process.platform === "win32") return process.env.APPDATA

  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

function readDevServiceListeners() {
  const result = Bun.spawnSync(
    ["lsof", "-nP", `-iTCP:${DEV_SERVICE_PORT}`, "-sTCP:LISTEN", "-t"],
    { stdout: "pipe", stderr: "ignore" },
  )

  const pids = [
    ...new Set(
      result.stdout
        .toString()
        .split(/\s+/)
        .filter((value) => /^\d+$/.test(value))
        .map(Number),
    ),
  ]

  return pids.flatMap((pid) => {
    const ppid = processOutput(["ps", "-o", "ppid=", "-p", String(pid)])
    const command = processOutput(["ps", "-o", "command=", "-p", String(pid)])

    return ppid && command ? [{ pid, ppid: Number(ppid), command }] : []
  })
}

function processOutput(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "ignore" })

  return result.exitCode === 0 ? result.stdout.toString().trim() : ""
}

async function waitForExit(pid: number, timeout: number) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (!isRunning(pid)) return true
    await Bun.sleep(100)
  }

  return !isRunning(pid)
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}
