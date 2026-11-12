- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Never edit generated client files.
- Keep runtime dependencies directed Schema → Core/Protocol → Server. Client runtime code may depend on Schema and Protocol, never Core or Server; `sdk` composes Client, Core and Server.
- No Changesets. Do not add `.changeset` files; follow the existing release workflow.
- Default branch is `dev`: base branches and worktrees on `origin/dev`, target PRs at `dev`, diff against `origin/dev` unless told otherwise.

## Live testing

- TUI: run `bun run dev:live [directory]` from a development worktree. It discovers the elected server with `opencode service status`, injects the credential from `opencode service get password`, and uses the `dev` storage channel. Prefer it over `bun run dev`, where an implicit managed-service connection may replace the live server.
- TUI story: add a fixture-driven story under `packages/tui/src/feature-plugins/system/storybook` and register it in `index.tsx`. Render the real component, keep side effects local, expose state dimensions through keybindings listed in `StoryFooter` (with a reset when combinations get confusing). Run with `OPENCODE_STORY=<story-id> bun run dev:live` and check narrow and wide terminals.
- Desktop: attach Playwright with `chromium.connectOverCDP(endpoint, { noDefaults: true })`. Without it Playwright emulates light mode and the window flashes until the connection closes. Never emulate color scheme or reduced motion on the user's live window; use an isolated context.
- Theme tokens: choose by semantic role, not current color. Never use raw `theme.hue` or borrow an unrelated token. `text.feedback`/`background.feedback` are for status only, forms use `formfield`, actions use `action`. Extend the theme schema, defaults, resolution and types when a role is missing, and verify both built-in themes plus the custom-theme fallback.

## Branch, commit, PR

- Branch: at most three hyphenated words, no slashes, no `feat/`-style prefixes, e.g. `session-recovery`.
- Commit and PR titles: `type(scope): summary`, type in `feat|fix|docs|chore|refactor|test`, scope optional (`core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, `plugin`).
- User-facing feat/fix/perf PRs carry a small looping animated SVG under `### Visual` (240×72, `currentColor` + opacity, CSS or SMIL only, under 8 KB, good still frame for reduced motion).

## Style

- Keep things in one function unless composable or reusable.
- Validate unknown values once at the owning boundary and pass typed values inward. Never revalidate what a schema, constructor or internal type already guarantees.
- No preemptive single-use helpers: inline unless reused, hiding a complex boundary, or named well enough to improve the caller.
- Before adding complexity for a speculative or vanishingly unlikely race or security edge case, state the concrete failure mode, likelihood and cost, and get buy-in.
- Prefer type inference, functional array methods (with type guards), Bun APIs (`Bun.file()`), `const`, early returns, no `else`, no `try`/`catch`, no `any`.
- Reduce variable count by inlining single-use values: `const journal = await Bun.file(path.join(dir, "journal.json")).json()`, not a separate `journalPath`.
- Use dot notation over destructuring (`obj.a`, not `const { a } = obj`).
- Imports: no aliases, no star imports, no type-position `import("...")`. Reference a module's own namespace by name (`import { Project } from "@opencode/core/project"`). Use dynamic imports for heavy startup-sensitive modules, destructured at the top of the narrowest scope that needs them.
- In `src/config`, follow the self-export pattern (`export * as ConfigAgent from "./agent.js"`).
- In Effect generators bind services to named variables first; no nested `yield* (yield* Foo.Service).bar()`.
- Complex logic: the main function reads as the happy path, supporting details in small helpers below it. Do not return `Effect` from helpers that only parse, validate or build options. Prefer `Schema.UnknownFromJsonString` / `Schema.decodeUnknownOption` over `JSON.parse` inside `Effect.try`.
- Drizzle: snake_case fields so columns need no string names (`id: text().primaryKey()`).
- Comment non-obvious constraints and surprising behavior, not obvious assignments.

## Experimental API and flags

- Experimental endpoint: `/api/experimental/<group>/...`, OpenAPI id `experimental.<group>.<method>`, SDK `client.experimental.<group>.<method>`, description "Experimental: may change without compatibility guarantees." `packages/protocol/test/experimental-identifiers.test.ts` enforces both directions. An experimental field or parameter on a stable endpoint goes under `experimental.<name>`. New endpoints and new default behaviors start experimental; graduating means moving the route out, dropping the prefix, and noting it in `CHANGELOG.md`. Routes change without aliases.
- A breaking move of shipped SDK or plugin API keeps the old names as `@deprecated` aliases until the next minor ("Removed in the next minor"); generated SDK moves come from codegen (`compile(..., { aliases: true })`), not by hand.
- Experimental plugin hooks are named `experimental.*`.
- Flags: new user-visible behavior, risky core changes and unreleased work need one; fixes, refactors, docs and tests do not. Declare key and description in `packages/schema/src/config/flag.ts`, read with `Flag.enabled("<key>")`. On in local and dev builds, off in releases; `experimental.<key>` and `OPENCODE_FLAGS="key,-other"` override. Say in the PR which flag guards it. `OPENCODE_FLAGS=all` / `experimental.all_flags: true` enable everything and a `-<key>` opt-out still wins. Ship by deleting the flag and its checks.

## Testing and checks

- Avoid mocks; no `globalThis.*` unless it is the only option. Test the real implementation, do not duplicate logic into tests.
- Tests cannot run from the repo root (`do-not-run-tests-from-root`); run from package directories such as `packages/core`.
- Before writing tests, read the matching skill in `.opencode/skills`: `unit-tests`, `tui-tests`, `app-e2e-tests`, `component-tests`.
- Verify with `bun run check` at the root; during iteration run `bun typecheck` in the package directory, never `tsc`. CI uses `typecheck:tsc` (`@typescript/native`), which wins on disagreement. `bun check` targets TypeScript 7.1 and writes no declarations (TS5088/TS2883 appear only in `tsc`); file minimal repros at oven-sh/bun.

## Session core

- Durable events record irreducible new facts only; enrich projections rather than repeating derivable state.
- Prompt admission stays separate from execution. `Session.prompt(...)` publishes `session.inbox.enqueued` (one `session_inbox` row) before advisory `SessionExecution.wake(sessionID)`, unless `resume: false` asks for admit-only. Delivery publishes `session.inbox.delivered`, whose projection consumes the row and inserts the visible message in one transaction. `session_inbox` holds only unconsumed work.
- Reusing a Session ID adopts the session. Reusing a user or synthetic inbox item ID is idempotent when session and type match (first admission wins; retried payload, metadata and delivery are ignored); cross-session or cross-type reuse fails. Control items keep operation-specific conflicts.
- `SessionExecution` stays process-global and session-ID based; it owns the process-local coordinator and resolves placement only when a drain starts. Interrupting a known idle or locally unowned session is a no-op; the public API rejects unknown sessions.
- `SessionRunner`, model resolution, tool registry, permissions and filesystem stay Location-scoped; omitted `Location.workspaceID` means implicit-local.
- Each step is one explicit `llm.stream` call that reloads history; no in-memory tool loop.
- Drains stay process-local until clustering exists. `SessionRunCoordinator` joins same-session resumes, coalesces wakeups and runs different sessions concurrently. The write-ahead execution claim marks a busy period for restart recovery, not clustered ownership or exactly-once.
- Delivery vocabulary: prompts steer by default; steered compaction wins up to the first steered move control, other steers keep enqueue order; at an idle boundary steers win, otherwise exactly one queued item delivers before reevaluation. Items can be cancelled or changed between queue and steer. Promoting new input resets the agent's step allowance (a steer batch once).
- One step is one logical LLM call; its durable record covers the model-visible span. "turn" is reserved for the future assistant-turn unit, never a single call.
