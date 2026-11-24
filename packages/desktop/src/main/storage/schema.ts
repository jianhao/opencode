import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

// Prompt drafts and history. `key` is `${storage}:${key}` as the renderer draft store writes it.
export const document = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})

// Images and text chunks referenced from documents by content hash. `touched_at` is the last time
// a blob was uploaded or a written document referenced it; collection leaves recent blobs alone.
export const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
  touched_at: integer().notNull().default(0),
})

// Everything the renderer persists through `platform.storage(name)`. `name` is the storage
// namespace the app chooses (still spelled like the `.dat` file it used to be) and `key` the
// entry within it, so the app's relocation and alias logic keeps working unchanged.
export const state = sqliteTable(
  "state",
  {
    name: text().notNull(),
    key: text().notNull(),
    value: text().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.key] })],
)

// GUI plugin enable state, for built-in and plugin GUIs alike. A plugin gets a row only once its
// enable state changes. `manifest` and `revision` are unused; they stay because releases from 2.0.24
// until the rename still read them, through the read-only `extension` view the rename migration leaves, so a
// downgraded app can open this database.
export const plugin = sqliteTable("plugin", {
  id: text().primaryKey(),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  manifest: text(),
  revision: text(),
})

// Workbench task: one Yunxiao item handled in one local directory. Identity lives here; the
// human-readable plan, tasks and evidence live under `.opencode/workbench/<serial>/` in the repo.
export const workbenchTask = sqliteTable(
  "workbench_task",
  {
    id: text().primaryKey(),
    item_id: text().notNull(),
    serial: text().notNull(),
    title: text().notNull(),
    space_id: text().notNull(),
    space_name: text().notNull(),
    url: text(),
    directory: text().notNull(),
    branch: text(),
    stage: text().notNull(),
    plan_dir: text().notNull(),
    plan_version: integer().notNull().default(0),
    active_run_id: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [uniqueIndex("workbench_task_item_directory_idx").on(table.item_id, table.directory)],
)

// One attempt at a task. A task can have several runs (plan, execution retries, review); the task
// keeps the stable identity and `active_run_id` points at the one the UI should open.
export const workbenchRun = sqliteTable(
  "workbench_run",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    session_id: text().notNull(),
    kind: text().notNull(),
    stage: text().notNull(),
    summary: text(),
    created_at: integer().notNull(),
    ended_at: integer(),
  },
  (table) => [index("workbench_run_task_idx").on(table.task_id, table.created_at)],
)

// Approval, verification and sync events. Append-only, used for audit and for rebuilding the UI.
export const workbenchEvent = sqliteTable(
  "workbench_event",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    type: text().notNull(),
    payload: text(),
    created_at: integer().notNull(),
  },
  (table) => [index("workbench_event_task_idx").on(table.task_id, table.created_at)],
)
