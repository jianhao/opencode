import type { ElectronAPI } from "../api-types"

/**
 * The workbench reads Yunxiao through the main process, so the renderer only sees plain JSON and
 * never the token. Structural typing keeps the app package from importing desktop types.
 */
export function createDesktopWorkbench(api: ElectronAPI) {
  return {
    state: (force?: boolean) => api.workbenchGetState(force),
    item: (id: string) => api.workbenchGetItem(id),
    setToken: (token: string) => api.workbenchSetToken(token),
    setSettings: (input: { frontendServerUrl: string; organizationId?: string }) => api.workbenchSetSettings(input),
  }
}
