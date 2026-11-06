import type { SessionMessageUser } from "@opencode/client/promise"
import type { ServerApi } from "@/runtime/server/api"

export const SESSION_OUTLINE_PAGE_LIMIT = 200

export const SESSION_OUTLINE_REQUEST_TIMEOUT_MS = 30_000

/** Loads every user turn for the navigator without loading assistant or tool content. */
export async function loadSessionOutlineMessages(input: {
  api: Pick<ServerApi, "message">
  sessionID: string
  signal: AbortSignal
}) {
  const messages: SessionMessageUser[] = []
  let cursor: string | undefined

  do {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(SESSION_OUTLINE_REQUEST_TIMEOUT_MS)])
    const page = await input.api.message.list(
      {
        sessionID: input.sessionID,
        limit: SESSION_OUTLINE_PAGE_LIMIT,
        order: "desc",
        type: "user",
        cursor,
      },
      { signal },
    )

    messages.push(...page.data.filter((message): message is SessionMessageUser => message.type === "user"))
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return messages.toReversed()
}

/** Combines the complete prompt index with newer rows the live transcript has already received. */
export function mergeSessionOutlineMessages(input: {
  history: readonly SessionMessageUser[]
  loaded: readonly SessionMessageUser[]
  revertMessageID?: string
}) {
  const messages = new Map<string, SessionMessageUser>()

  for (const message of input.history) messages.set(message.id, message)
  for (const message of input.loaded) messages.set(message.id, message)

  return [...messages.values()]
    .toSorted((left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id))
    .filter((message) => input.revertMessageID === undefined || message.id < input.revertMessageID)
}
