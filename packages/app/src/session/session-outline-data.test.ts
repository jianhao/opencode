import { expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import { loadSessionOutlineMessages, mergeSessionOutlineMessages } from "./session-outline-data"

const user = (id: string, created: number): SessionMessageUser => ({
  id,
  type: "user",
  text: id,
  time: { created },
})

test("loads every prompt page without loading the rest of the transcript", async () => {
  const requested: Array<{ cursor?: string; type?: string }> = []
  const api = {
    message: {
      list: async (input: { cursor?: string; type?: string }) => {
        requested.push({ cursor: input.cursor, type: input.type })

        return input.cursor === "older"
          ? { data: [user("msg_old", 1)], cursor: {} }
          : { data: [user("msg_new", 3), user("msg_mid", 2)], cursor: { next: "older" } }
      },
    },
  } as unknown as Pick<ServerApi, "message">

  const messages = await loadSessionOutlineMessages({
    api,
    sessionID: "ses_outline",
    signal: new AbortController().signal,
  })

  expect(messages.map((message) => message.id)).toEqual(["msg_old", "msg_mid", "msg_new"])
  expect(requested).toEqual([
    { cursor: undefined, type: "user" },
    { cursor: "older", type: "user" },
  ])
})

test("merges newly delivered prompts once and respects the revert boundary", () => {
  const messages = mergeSessionOutlineMessages({
    history: [user("msg_1", 1), user("msg_2", 2)],
    loaded: [user("msg_2", 2), user("msg_3", 3), user("msg_4", 4)],
    revertMessageID: "msg_4",
  })

  expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3"])
})
