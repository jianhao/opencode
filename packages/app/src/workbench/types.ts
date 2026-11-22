/**
 * Workbench view types.
 *
 * The main process contract lives in `@opencode/desktop`'s shared ipc-rpc; this package keeps a
 * structural copy so the app never imports the desktop package. `createDesktopPlatform` returns an
 * object that must stay assignable to `WorkbenchBridge` below.
 */

export type Readiness = "ready" | "clarify" | "blocked"

export type WorkbenchReason = { level: "pass" | "risk" | "block"; message: string }

export type WorkbenchItem = {
  id: string
  source: "yunxiao" | "manual"
  serial: string
  title: string
  url?: string
  category: "Req" | "Task" | "Bug" | "Other"
  categoryName: string
  statusName: string
  statusStage?: string
  priority?: string
  priorityName?: string
  spaceId: string
  spaceName: string
  assigneeName?: string
  createdAt?: string
  updatedAt?: string
  readiness: Readiness
  reasons: readonly WorkbenchReason[]
}

export type WorkbenchSnapshot = {
  serverUrl: string
  fetchedAt: number
  token: { configured: boolean; source: "env" | "stored" | "none"; userName?: string }
  items: readonly WorkbenchItem[]
  counts: { total: number; ready: number; clarify: number; blocked: number }
  warnings: readonly string[]
  error?: string
}

export type WorkbenchDetail = {
  item: WorkbenchItem
  description: string
  comments: ReadonlyArray<{ author: string; created?: string; content: string }>
  attachments: ReadonlyArray<{ name: string; url?: string }>
  relations: ReadonlyArray<{ serial: string; title: string; statusName?: string; relation: string }>
}

export type WorkbenchBridge = {
  state(force?: boolean): Promise<WorkbenchSnapshot>
  item(id: string): Promise<WorkbenchDetail>
  setToken(token: string): Promise<WorkbenchSnapshot>
  setSettings(input: { frontendServerUrl: string; organizationId?: string }): Promise<WorkbenchSnapshot>
}
