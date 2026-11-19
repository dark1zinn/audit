/**
 * Version snapshots of a doc's current state. Numbers are per doc and dense (1, 2, 3, ...).
 */
import { docs, docVersions } from "@audit/db/schema"
import type { DocVersion, DocVersionContent, VersionKind } from "@audit/domain/docs/schema"
import type { DocId, DocVersionId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { type SQL, desc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

/** Copies the doc's current Yjs state and JSON content into a new version row. Returns its number. */
export const snapshotDoc = (
  docId: DocId,
  kind: VersionKind,
  label: string | null,
  createdBy: UserId | null,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [doc] = yield* db
      .select({ ydoc: docs.ydoc, content: docs.content })
      .from(docs)
      .where(eq(docs.id, docId))
      .pipe(Effect.orDie)
    const [row] = yield* db
      .insert(docVersions)
      .values({
        docId,
        version: sql`(select coalesce(max(${docVersions.version}), 0) + 1 from ${docVersions} where ${docVersions.docId} = ${docId})`,
        snapshot: doc?.ydoc ?? new Uint8Array(),
        content: doc?.content ?? { type: "doc", content: [] },
        label,
        kind,
        createdBy,
      })
      .returning({ version: docVersions.version })
      .pipe(Effect.orDie)
    return row!.version
  })

/** Version rows matching `where`, newest first, with their JSON content. */
export const selectVersions = (where: SQL | undefined) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db
      .select({
        id: docVersions.id,
        docId: docVersions.docId,
        version: docVersions.version,
        label: docVersions.label,
        kind: docVersions.kind,
        createdBy: docVersions.createdBy,
        createdAt: docVersions.createdAt,
        content: docVersions.content,
      })
      .from(docVersions)
      .where(where)
      .orderBy(desc(docVersions.version))
      .pipe(Effect.orDie)
  })

export interface VersionRow {
  readonly id: string
  readonly docId: string
  readonly version: number
  readonly label: string | null
  readonly kind: VersionKind
  readonly createdBy: string | null
  readonly createdAt: Date
  readonly content: unknown
}

/** The public version shape, without its content. */
export const toVersion = (row: VersionRow): DocVersion => ({
  id: row.id as DocVersionId,
  docId: row.docId as DocId,
  version: row.version,
  label: row.label,
  kind: row.kind,
  createdBy: row.createdBy as UserId | null,
  createdAt: row.createdAt,
})

/** A version with its JSON content, for diffs. */
export const toVersionContent = (row: VersionRow): DocVersionContent => ({
  ...toVersion(row),
  content: row.content as DocVersionContent["content"],
})
