/**
 * Loads the text of one indexable entity and turns it into chunks. Reads only; the sync command
 * writes. Replies are never indexed on their own: their thread root carries them.
 */
import { childrenOf, isJsonNode } from "@audit/editor/json"
import { jsonToText } from "@audit/editor/text"
import { Db } from "@audit/platform/database"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import {
  type Chunk,
  chunkEvent,
  chunkSections,
  chunkTask,
  chunkThread,
  type Section,
} from "./chunk.ts"

export const INDEXABLE_TYPES = ["doc", "task", "message", "event"] as const

interface EntityRow {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly deleted_at: Date | null
}

/** Top-level blocks of a rich-text document; a heading starts a new section. */
const docSections = (root: unknown): ReadonlyArray<Section> => {
  if (!isJsonNode(root)) return []
  const sections: { heading: string; body: string[] }[] = [{ heading: "", body: [] }]
  for (const node of childrenOf(root)) {
    const text = jsonToText(node)
    if (node.type === "heading") sections.push({ heading: text, body: [] })
    else sections.at(-1)?.body.push(text)
  }
  return sections.map((s) => ({ heading: s.heading, body: s.body.join("\n") }))
}

/** Rich text stored as JSON to plain text; anything that is not a node reads as empty. */
const richText = (value: unknown): string => (isJsonNode(value) ? jsonToText(value) : "")

export interface LoadedChunks {
  readonly type: string
  readonly chunks: ReadonlyArray<Chunk>
}

/** Loads the entity and its chunks. `null` when the entity is gone or not indexable. */
export const loadChunks = (entityId: string): Effect.Effect<LoadedChunks | null, never, Db> =>
  Effect.gen(function* () {
    const db = yield* Db
    const entity = yield* db
      .execute<EntityRow>(
        sql`select id, type, title, deleted_at from entities where id = ${entityId}`,
      )
      .pipe(
        Effect.map((result) => result.rows[0]),
        Effect.orDie,
      )
    if (entity === undefined || entity.deleted_at !== null) return null
    const title = entity.title

    if (entity.type === "doc") {
      const doc = yield* db
        .execute<{ content: unknown }>(sql`select content from docs where id = ${entityId}`)
        .pipe(
          Effect.map((result) => result.rows[0]),
          Effect.orDie,
        )
      if (doc === undefined) return null
      return { type: "doc", chunks: chunkSections(title, docSections(doc.content)) }
    }

    if (entity.type === "task") {
      const task = yield* db
        .execute<{ description: unknown }>(
          sql`select description from tasks where id = ${entityId}`,
        )
        .pipe(
          Effect.map((result) => result.rows[0]),
          Effect.orDie,
        )
      if (task === undefined) return null
      const comments = yield* db
        .execute<{ body_text: string }>(sql`
          select c.body_text from comments c
          join entities e on e.id = c.id
          where c.target_id = ${entityId} and e.deleted_at is null
          order by e.created_at desc limit 5`)
        .pipe(
          Effect.map((result) => result.rows),
          Effect.orDie,
        )
      return {
        type: "task",
        chunks: chunkTask(
          title,
          richText(task.description),
          comments.map((c) => c.body_text).reverse(),
        ),
      }
    }

    if (entity.type === "message") {
      const root = yield* db
        .execute<{ body_text: string; thread_root_id: string | null; deleted_at: Date | null }>(
          sql`select body_text, thread_root_id, deleted_at from messages where id = ${entityId}`,
        )
        .pipe(
          Effect.map((result) => result.rows[0]),
          Effect.orDie,
        )
      if (root === undefined || root.thread_root_id !== null) return null
      if (root.deleted_at !== null) return { type: "message", chunks: [] }
      const replies = yield* db
        .execute<{ body_text: string }>(sql`
          select m.body_text from messages m
          join entities e on e.id = m.id
          where m.thread_root_id = ${entityId} and m.deleted_at is null
          order by e.created_at`)
        .pipe(
          Effect.map((result) => result.rows),
          Effect.orDie,
        )
      return {
        type: "message",
        chunks: chunkThread(
          title,
          root.body_text,
          replies.map((r) => r.body_text),
        ),
      }
    }

    if (entity.type === "event") {
      const event = yield* db
        .execute<{ location: string; description: unknown }>(
          sql`select location, description from events where id = ${entityId}`,
        )
        .pipe(
          Effect.map((result) => result.rows[0]),
          Effect.orDie,
        )
      if (event === undefined) return null
      return {
        type: "event",
        chunks: chunkEvent(title, [event.location, richText(event.description)]),
      }
    }

    return null
  })
