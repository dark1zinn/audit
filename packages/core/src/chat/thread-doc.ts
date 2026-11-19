/**
 * Thread to doc: kept out of `commands.ts` so chat does not import the docs commands, which import
 * project commands, which import chat (`createProject` creates the project channel).
 */
import { entities, messages } from "@audit/db/schema"
import { ThreadToDocInput, CreatedFromMessage } from "@audit/domain/chat/schema"
import type { EntityId } from "@audit/domain/ids"
import { MessageId as MessageIdSchema } from "@audit/domain/ids"
import { jsonToState } from "@audit/editor/ydoc"
import { Db } from "@audit/platform/database"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { createDoc } from "../docs/commands.ts"
import { saveDocContent } from "../docs/content.ts"
import { record } from "../trail.ts"
import { entityOf, invalid, threadAuthorize } from "./commands.ts"
import { messageRow, threadRootOf } from "./queries.ts"

/** The workspace space entity, which parents docs that live outside any project. */
const spaceEntity = () =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.type, "space"))
      .limit(1)
      .pipe(Effect.orDie)
    if (row === undefined) return yield* invalid("No space to put this doc in", "projectId")
    return row.id as EntityId
  })

export const threadToDoc = Command.make("thread.to_doc", {
  input: Schema.Struct({ messageId: MessageIdSchema, ...ThreadToDocInput.fields }),
  output: CreatedFromMessage,
  authorize: (input) => threadAuthorize(input.messageId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("thread.to_doc")
      const rootId = yield* threadRootOf(input.messageId)
      const root = yield* messageRow(rootId)
      const rows = yield* db
        .select({
          body: messages.body,
          bodyText: messages.bodyText,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(and(isNull(messages.deletedAt), inArray(messages.id, [rootId])))
        .pipe(Effect.orDie)
      const replies = yield* db
        .select({ body: messages.body, deletedAt: messages.deletedAt })
        .from(messages)
        .where(and(eq(messages.threadRootId, rootId), isNull(messages.deletedAt)))
        .orderBy(asc(messages.id))
        .pipe(Effect.orDie)
      const [first] = rows
      const title = (input.title?.trim() || first?.bodyText.trim().slice(0, 120) || "Thread").slice(
        0,
        300,
      )
      const parentId = input.projectId ? entityOf(input.projectId) : yield* spaceEntity()
      const doc = yield* createDoc.execute({ parentId, title })
      const content = [
        ...(first?.body && typeof first.body === "object" && "content" in first.body
          ? (first.body.content as unknown[])
          : []),
        ...replies.flatMap((reply) =>
          typeof reply.body === "object" && reply.body !== null && "content" in reply.body
            ? (reply.body.content as unknown[])
            : [],
        ),
      ]
      yield* saveDocContent.execute({
        docId: doc.id,
        ydocState: jsonToState({ type: "doc", content: content as never }),
      })
      yield* record({
        action: "thread.to_doc",
        entityId: entityOf(rootId),
        entityType: "message",
        details: { docId: doc.id, by: userId, channelId: root.channelId },
      })
      return { entityId: entityOf(doc.id), docId: doc.id }
    }),
})
