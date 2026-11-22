import { Effect } from "effect"
import { WorkbenchRpcs } from "../../shared/ipc-rpc"
import { Workbench } from "../workbench"

export const workbenchHandlers = WorkbenchRpcs.toLayer(
  Effect.gen(function* () {
    const workbench = yield* Workbench.Service

    return WorkbenchRpcs.of({
      WorkbenchGetState: ({ force }) => Effect.promise(() => workbench.state({ force })),
      WorkbenchGetItem: ({ id }) => Effect.promise(() => workbench.item(id)),
      WorkbenchSetToken: ({ token }) => Effect.promise(() => workbench.setToken(token)),
      WorkbenchSetSettings: ({ frontendServerUrl, organizationId }) =>
        Effect.promise(() => workbench.setSettings({ frontendServerUrl, organizationId })),
    })
  }),
)
