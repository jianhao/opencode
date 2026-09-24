import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const UpdatePayload = Schema.Struct({
  spec: Schema.String,
})

const UpdateResult = Schema.Struct({
  version: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginUpdateResult" })

export const PluginPaths = {
  update: "/plugin/update",
} as const

export const PluginApi = HttpApi.make("plugin")
  .add(
    HttpApiGroup.make("plugin")
      .add(
        HttpApiEndpoint.post("update", PluginPaths.update, {
          query: WorkspaceRoutingQuery,
          payload: UpdatePayload,
          success: described(UpdateResult, "Plugin updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "plugin.update",
            summary: "Update plugin",
            description:
              "Re-resolve an unpinned npm plugin to the latest published version and reload it for the current directory.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "plugin",
          description: "Plugin management routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode plugin HttpApi",
      version: "0.0.1",
      description: "Plugin management HttpApi surface.",
    }),
  )
