import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as chat from "@audit/core/chat/commands"
import { purgeMessages } from "@audit/core/chat/retention"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const exists = async (id: string) => {
  const rows = await database.superuser`select id from messages where id = ${id}`
  return rows.length === 1
}

const deletedAt = async (id: string) => {
  const rows = await database.superuser`select deleted_at from messages where id = ${id}`
  return rows[0]?.deleted_at ?? null
}

/** Moves a message's creation time back so the retention window applies to it. */
const backdate = async (id: string, days: number) => {
  await database.superuser`update entities set created_at = now() - make_interval(days => ${days}) where id = ${id}`
}

const trailCount = async (action: string) => {
  const rows =
    await database.superuser`select count(*)::int as n from trail_events where action = ${action}`
  return rows[0]?.n ?? 0
}

const setRetention = async (days: number | null) => {
  await database.superuser`update workspace set settings = jsonb_set(settings, '{messageRetentionDays}', coalesce(to_jsonb(${days}::int), 'null'::jsonb))`
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("message retention", () => {
  test("does nothing while the workspace keeps messages forever", async () => {
    await setRetention(null)
    const result = await runAs(database, system)(purgeMessages.execute({}))
    expect(result.purged).toBe(0)
  })

  test("purges old unpinned messages, tombstones old roots with replies, and keeps pins and recent ones", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "retained", kind: "public" }))
    const post = (text: string, threadRootId?: MessageId) =>
      runAs(
        database,
        owner.actor,
      )(
        chat.postMessage.execute({
          channelId: channel.id as ChannelId,
          body: paragraph(text),
          ...(threadRootId === undefined ? {} : { threadRootId }),
        }),
      )

    const old = await post("old and gone")
    const pinned = await post("old but pinned")
    const root = await post("old root")
    const reply = await post("recent reply", root.id as MessageId)
    const recent = await post("recent")
    for (const message of [old, pinned, root]) await backdate(message.id, 90)

    await runAs(
      database,
      owner.actor,
    )(chat.pinMessage.execute({ messageId: pinned.id as MessageId }))

    const trailBefore = await trailCount("message.purged")
    await setRetention(30)
    const result = await runAs(database, system)(purgeMessages.execute({}))

    expect(result.purged).toBe(2)
    expect(await exists(old.id)).toBe(false)
    expect(await exists(pinned.id)).toBe(true)
    expect(await exists(recent.id)).toBe(true)
    expect(await exists(reply.id)).toBe(true)
    expect(await exists(root.id)).toBe(true)
    expect(await deletedAt(root.id)).not.toBeNull()
    expect(await trailCount("message.purged")).toBe(trailBefore + 1)
  })
})
