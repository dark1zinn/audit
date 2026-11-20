import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as chat from "@audit/core/chat/commands"
import { createDoc } from "@audit/core/docs/commands"
import { saveDocContent } from "@audit/core/docs/content"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, EntityId } from "@audit/domain/ids"
import { jsonToState } from "@audit/editor/ydoc"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person

const linkDoc = (href: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href } }] }],
    },
  ],
})

const imageDoc = (src: string) => ({
  type: "doc" as const,
  content: [{ type: "image", attrs: { src } }],
})

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("rich text sanitisation on write", () => {
  test("chat rejects a javascript: link", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "unsafe-link", kind: "public" }))
    const exit = await exitAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: linkDoc("javascript:alert(1)") }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("chat rejects an external image", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "external-image", kind: "public" }))
    const exit = await exitAs(
      database,
      owner.actor,
    )(
      chat.postMessage.execute({
        channelId: channel.id,
        body: imageDoc("https://evil.example/x.png"),
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("chat keeps an https link", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "safe-link", kind: "public" }))
    const exit = await exitAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: linkDoc("https://example.com") }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("doc content save rejects an external image", async () => {
    const docId = (
      await runAs(
        database,
        owner.actor,
      )(createDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, title: "Unsafe" }))
    ).id as DocId
    const exit = await exitAs(
      database,
      owner.actor,
    )(
      saveDocContent.execute({
        docId,
        ydocState: jsonToState(imageDoc("https://evil.example/x.png")),
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
