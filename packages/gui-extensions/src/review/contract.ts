import type { FileDiffInfo } from "@opencode/client/promise"
import { Contract, type SessionRef, type SessionScreen } from "../sdk"

export type ChangeKind = "add" | "del" | "mix"

/**
 * How far a session's changes are from being usable, so a caller shows the right copy.
 *
 * - `idle`: no attempt can run yet, such as before the session's review mode is known.
 * - `loading`: an attempt is running.
 * - `ready`: the last attempt succeeded; an empty list is then a real "no changes".
 * - `failed`: the last attempt failed; the list still holds the last successful changes, if any.
 */
export type ChangeStatus = "idle" | "loading" | "ready" | "failed"

/** The routed session's changes as the review panel shows them. Empty for other sessions. */
export interface Changes {
  /** The current review mode's diffs: the last successful changes, empty until one loads. Reactive. */
  diffs(session: SessionRef): readonly FileDiffInfo[]
  /** The current review mode's load state. A caller must not read `failed` as "no changes". */
  status(session: SessionRef): ChangeStatus
  /** The change kind of each changed file and each of its directories, keyed by normalized path. */
  kinds(session: SessionRef): ReadonlyMap<string, ChangeKind>
  /** The file the review panel shows. */
  active(session: SessionRef): string | undefined
  /**
   * The session directory's uncommitted changes, independent of the review mode (the session details' changes row).
   * Loads only while a `details` watch holds, and holds the last successful changes until a newer load lands.
   */
  details(session: SessionRef): readonly FileDiffInfo[] | undefined
  /** The session details row's load state, the same states as `status`. */
  detailsStatus(session: SessionRef): ChangeStatus
  /** Opens the side region and shows `path` in the review panel. */
  focus(session: SessionRef, path: string): void
  /** Shows the changes: opens the side region, or on narrow screens switches to the Changes view. */
  open(session: SessionRef): void
  /**
   * Keeps the changes of the view the caller renders loaded while it shows them, across the view's session
   * switches. A `tree` is a persistent change list: opening the side region refreshes the changes it shows.
   * `details` loads `details(session)`.
   *
   * @param screen - The owning screen from the panel or session-slot input, available even before publication.
   * @param source - The view's demand: a tree, file markers or session details.
   */
  watch(screen: SessionScreen, source: "tree" | "files" | "details"): () => void
  /** Runs when review reveals a change (e.g. from a composer comment), so change lists can show theirs. */
  onReveal(listener: () => void): () => void
}

/** The review extension provides this. The session details' changes row reads the same data. */
export const Changes = Contract.define<Changes, "review.changes">("review.changes")
