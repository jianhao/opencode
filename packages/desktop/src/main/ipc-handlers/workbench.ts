import { Effect } from "effect"
import { WorkbenchRpcs } from "../../shared/ipc-rpc"
import { Workbench } from "../workbench"

export const workbenchHandlers = WorkbenchRpcs.toLayer(
  Effect.gen(function* () {
    const workbench = yield* Workbench.Service

    return WorkbenchRpcs.of({
      WorkbenchGetState: ({ force }) => Effect.promise(() => workbench.state({ force })),
      WorkbenchGetItem: ({ id, config }) => Effect.promise(() => workbench.item(id, config)),
      WorkbenchSetToken: ({ token }) => Effect.promise(() => workbench.setToken(token)),
      WorkbenchSetSettings: ({ frontendServerUrl, organizationId }) =>
        Effect.promise(() => workbench.setSettings({ frontendServerUrl, organizationId })),
      WorkbenchPreflight: ({ directory }) => Effect.promise(() => workbench.preflight(directory)),
      WorkbenchTaskList: () => Effect.sync(() => workbench.tasks()),
      WorkbenchTaskStart: (input) => Effect.promise(() => workbench.taskStart(input)),
      WorkbenchTaskSetStage: (input) => Effect.promise(() => workbench.taskSetStage(input)),
      WorkbenchTaskBindRun: (input) => Effect.promise(() => workbench.taskBindRun(input)),
      WorkbenchTaskApprove: ({ id }) => Effect.promise(() => workbench.taskApprove(id)),
      WorkbenchTaskDocs: ({ id }) => Effect.promise(() => workbench.taskDocs(id)),
    })
  }),
)
