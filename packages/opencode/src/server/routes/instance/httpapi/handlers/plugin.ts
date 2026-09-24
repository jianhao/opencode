import { Plugin } from "@/plugin"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { UpdatePayload } from "../groups/plugin"

export const pluginHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin", (handlers) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service

    const update = Effect.fn("PluginHttpApi.update")(function* (ctx: { payload: typeof UpdatePayload.Type }) {
      return yield* plugin.update(ctx.payload.spec).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    return handlers.handle("update", update)
  }),
)
