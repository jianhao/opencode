export * as Plugin from "./plugin"

import { Schema } from "effect"
import { define, inventory } from "./event"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

const Added = define({
  type: "plugin.added",
  schema: { id: ID },
})

// 插件在不带固定版本时会被重新解析到最新版；resolved 版本与缓存版本不同说明发生了更新。
const Updated = define({
  type: "plugin.updated",
  schema: {
    spec: Schema.String,
    from: Schema.String,
    to: Schema.String,
  },
})

// "仅提示" 模式下只检查不发版：缓存版本 current 之后已经在 registry 上有 latest。
const UpdateAvailable = define({
  type: "plugin.update_available",
  schema: {
    spec: Schema.String,
    current: Schema.String,
    latest: Schema.String,
  },
})

export const Event = { Added, Updated, UpdateAvailable, Definitions: inventory(Added, Updated, UpdateAvailable) }
