import type { ElectronAPI } from "../api-types"
import type { DetailConfig as WorkbenchDetailConfig } from "../../shared/ipc-rpc/workbench"

/**
 * The workbench reads Yunxiao through the main process, so the renderer only sees plain JSON and
 * never the token. Structural typing keeps the app package from importing desktop types.
 */
export function createDesktopWorkbench(api: ElectronAPI) {
  return {
    state: (force?: boolean) => api.workbenchGetState(force),
    item: (id: string, config?: WorkbenchDetailConfig, force?: boolean) => api.workbenchGetItem(id, config, force),
    setToken: (token: string) => api.workbenchSetToken(token),
    setSettings: (input: { frontendServerUrl: string; organizationId?: string }) => api.workbenchSetSettings(input),
    preflight: (directory: string) => api.workbenchPreflight(directory),
    tasks: () => api.workbenchTaskList(),
    taskStart: (input: Parameters<ElectronAPI["workbenchTaskStart"]>[0]) => api.workbenchTaskStart(input),
    taskSetStage: (input: Parameters<ElectronAPI["workbenchTaskSetStage"]>[0]) => api.workbenchTaskSetStage(input),
    taskBindRun: (input: Parameters<ElectronAPI["workbenchTaskBindRun"]>[0]) => api.workbenchTaskBindRun(input),
    taskApprove: (id: string) => api.workbenchTaskApprove(id),
    taskDocs: (id: string) => api.workbenchTaskDocs(id),
  }
}
