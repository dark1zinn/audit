/**
 * Doc content: Yjs state load/save, version restore, Markdown/HTML export and import.
 *
 * The signatures are the contract the commands and HTTP handlers call. Saves go through
 * `saveDocContent`, a Command, so the collab server writes the same way every other feature does.
 */
import { docs, docVersions, entities, trailEvents } from "@audit/db/schema"
import type { DocChanged } from "@audit/domain/events"
import type { ExportFormat, ImportMarkdownInput } from "@audit/domain/docs/schema"
import type { DocId, DocVersionId, EntityId, ProjectId, UserId } from "@audit/domain/ids"
import { NotFound } from "@audit/domain/errors"
import { Db } from "@audit/platform/database"
import { jsonToHtml } from "@audit/editor/html"
import { isJsonNode, type JsonNode } from "@audit/editor/json"
import { jsonToMarkdown, markdownToJson } from "@audit/editor/markdown"
import { extractMentions } from "@audit/editor/mentions"
import { jsonToText } from "@audit/editor/text"
import { EMPTY_DOC, jsonToState, stateToJson } from "@audit/editor/ydoc"
import { and, desc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import { cleanRichDoc } from "../rich-text.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { createEntity, touchEntity } from "../entities.ts"
import { syncReferences } from "../references.ts"
import { CommandScope, emit, record } from "../trail.ts"
import { assertWritable } from "../projects/read.ts"
import { loadDoc, positionAmong } from "./read.ts"
import { snapshotDoc } from "./versions.ts"

export interface DocState {
  readonly ydoc: Uint8Array | null
  readonly content: Record<string, unknown> | null
}

export interface ExportedDoc {
  readonly filename: string
  readonly contentType: string
  readonly body: string
}

/** Coalescing window for `doc.edited` audit entries, per user and doc. */
const AUDIT_WINDOW_MS = 10 * 60_000
/** A save whose text moved this many characters since the last audit entry is always recorded. */
const AUDIT_CHARS = 1000

/** Loads the doc's Yjs state and JSON content. */
export const loadDocState = (docId: DocId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ ydoc: docs.ydoc, content: docs.content })
      .from(docs)
      .where(eq(docs.id, docId))
      .pipe(Effect.orDie)
    return {
      ydoc: row?.ydoc ?? null,
      content: row?.content ?? null,
    } satisfies DocState
  })

const SaveDocContentInput = Schema.Struct({
  docId: Schema.String,
  ydocState: Schema.Uint8Array,
})

/** The `chars` recorded in a `doc.edited` entry's details, 0 when absent. */
const auditChars = (meta: unknown): number => {
  if (typeof meta !== "object" || meta === null || !("details" in meta)) return 0
  const details = meta.details
  if (typeof details !== "object" || details === null || !("chars" in details)) return 0
  return typeof details.chars === "number" ? details.chars : 0
}

/** The last `doc.edited` entry by this user on this doc, or null when there is none. */
const lastAudit = (docId: DocId, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [last] = yield* db
      .select({ at: trailEvents.at, meta: trailEvents.meta })
      .from(trailEvents)
      .where(
        and(
          eq(trailEvents.action, "doc.edited"),
          eq(trailEvents.entityId, docId),
          eq(trailEvents.actorId, userId),
        ),
      )
      .orderBy(desc(trailEvents.at))
      .limit(1)
      .pipe(Effect.orDie)
    if (last === undefined) return null
    return { at: last.at, chars: auditChars(last.meta) }
  })

/**
 * Persists the Yjs state after an edit, with its derived JSON and text, and the mention references.
 * Runs as a command: the actor is the editing user. The `doc.edited` audit entry is coalesced: one
 * per user and doc per 10 minutes, unless the text moved by `AUDIT_CHARS` since that entry.
 */
export const saveDocContent = Command.make("doc.content.save", {
  input: SaveDocContentInput,
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("doc.update", input.docId as DocId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const docId = input.docId as DocId
      const userId = yield* currentUser("doc.content.save")
      const db = yield* Db
      const doc = yield* loadDoc(docId)
      if (doc.projectId !== null) yield* assertWritable(doc.projectId)
      const json = yield* cleanRichDoc(stateToJson(input.ydocState), "content")
      const text = jsonToText(json)
      const now = new Date()
      yield* db
        .update(docs)
        .set({
          ydoc: input.ydocState,
          content: json as Record<string, unknown>,
          contentText: text,
          lastEditedBy: userId,
          lastEditedAt: now,
        })
        .where(eq(docs.id, docId))
        .pipe(Effect.orDie)
      yield* db
        .update(entities)
        .set({ searchText: text, updatedAt: now })
        .where(eq(entities.id, docId))
        .pipe(Effect.orDie)
      yield* syncReferences(
        docId,
        "mention",
        extractMentions(json).map((mention) => ({
          targetId: mention.id as EntityId,
          snippet: mention.snippet,
        })),
      )
      // The command's automatic trail entry is replaced by the coalesced `doc.edited` below.
      const scope = yield* CommandScope
      scope.trailEntries++
      const last = yield* lastAudit(docId, userId)
      const chars = text.length
      const due =
        last === null ||
        now.getTime() - last.at.getTime() >= AUDIT_WINDOW_MS ||
        Math.abs(chars - last.chars) >= AUDIT_CHARS
      if (due) {
        yield* record({
          action: "doc.edited",
          entityId: docId,
          entityType: "doc",
          projectId: doc.projectId,
          details: { chars },
        })
      } else {
        scope.trailEntries--
      }
      yield* emit({
        _tag: "DocChanged",
        kind: "edited",
        docId,
        entityId: docId,
        projectId: doc.projectId,
        actorId: userId,
        version: doc.version,
      } satisfies typeof DocChanged.Type)
    }),
})

/**
 * Replaces the doc's content with a version's snapshot, records a `restore` version, writes a
 * `doc.version_restored` audit entry and emits one `restored` DocChanged after the commit.
 */
export const restoreVersion = (versionId: DocVersionId, restoredBy: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        docId: docVersions.docId,
        version: docVersions.version,
        snapshot: docVersions.snapshot,
        content: docVersions.content,
      })
      .from(docVersions)
      .where(eq(docVersions.id, versionId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "doc_version", id: versionId })
    yield* replaceDocState(
      row.docId as DocId,
      { ydoc: row.snapshot, content: row.content },
      restoredBy,
      { action: "doc.version_restored", details: { version: row.version }, versionKind: "restore" },
    )
  })

/**
 * The one path that replaces a doc's content: stores the Yjs state and its JSON, snapshots the
 * result, records the trail entry, and emits one `restored` DocChanged so live sessions reload.
 * Version restore and approved AI edits both write through here.
 */
export const replaceDocState = (
  docId: DocId,
  state: Pick<typeof docs.$inferInsert, "ydoc" | "content">,
  editedBy: UserId,
  change: {
    readonly action: string
    readonly details: Record<string, unknown>
    readonly versionKind: "auto" | "restore"
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const doc = yield* loadDoc(docId)
    const json = isJsonNode(state.content)
      ? yield* cleanRichDoc(state.content, "content")
      : EMPTY_DOC
    const text = jsonToText(json)
    yield* db
      .update(docs)
      .set({
        ydoc: state.ydoc,
        content: json as Record<string, unknown>,
        contentText: text,
        lastEditedBy: editedBy,
        lastEditedAt: new Date(),
      })
      .where(eq(docs.id, docId))
      .pipe(Effect.orDie)
    const version = yield* touchEntity(docId, { searchText: text })
    yield* snapshotDoc(docId, change.versionKind, null, editedBy)
    yield* record({
      action: change.action,
      entityId: docId,
      entityType: "doc",
      projectId: doc.projectId,
      details: change.details,
    })
    yield* emit({
      _tag: "DocChanged",
      kind: "restored",
      docId,
      entityId: docId,
      projectId: doc.projectId,
      actorId: editedBy,
      version,
    } satisfies typeof DocChanged.Type)
  })

const slugOf = (title: string) => {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : "doc"
}

/** Renders the doc as Markdown or HTML. */
export const exportDoc = (docId: DocId, format: ExportFormat) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ title: entities.title, content: docs.content })
      .from(docs)
      .innerJoin(entities, eq(entities.id, docs.id))
      .where(eq(docs.id, docId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "doc", id: docId })
    const json: JsonNode = isJsonNode(row.content) ? row.content : EMPTY_DOC
    const slug = slugOf(row.title)
    if (format === "md") {
      return {
        filename: `${slug}.md`,
        contentType: "text/markdown; charset=utf-8",
        body: jsonToMarkdown(json),
      } satisfies ExportedDoc
    }
    const title = row.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${jsonToHtml(json)}</body></html>\n`
    return {
      filename: `${slug}.html`,
      contentType: "text/html; charset=utf-8",
      body,
    } satisfies ExportedDoc
  })

/** Where a doc created under `parentId` lives: its project (null in the space) and parent doc. */
const placementUnder = (parentId: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [parent] = yield* db
      .select({ type: entities.type, projectId: entities.projectId })
      .from(entities)
      .where(eq(entities.id, parentId))
      .pipe(Effect.orDie)
    if (parent?.type === "project") {
      return { projectId: parentId as ProjectId, parentDocId: null }
    }
    if (parent?.type === "doc") {
      const parentDoc = yield* loadDoc(parentId as DocId)
      return { projectId: parentDoc.projectId, parentDocId: parentDoc.id as DocId }
    }
    return { projectId: (parent?.projectId ?? null) as ProjectId | null, parentDocId: null }
  })

/** Creates a doc under `parentId` from Markdown. Returns the new doc id. */
export const importMarkdown = (input: ImportMarkdownInput, createdBy: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const json = yield* cleanRichDoc(markdownToJson(input.markdown), "markdown")
    const firstHeading = json.content?.find((node) => node.type === "heading")
    const headingText = jsonToText({ type: "doc", content: firstHeading ? [firstHeading] : [] })
    const title = input.title ?? (headingText.length > 0 ? headingText : "Untitled")
    const text = jsonToText(json)
    const placement = yield* placementUnder(input.parentId as EntityId)
    const id = yield* createEntity<DocId>({
      type: "doc",
      title,
      searchText: text,
      parentId: input.parentId as EntityId,
      projectId: placement.projectId,
    })
    yield* db
      .insert(docs)
      .values({
        id,
        parentDocId: placement.parentDocId,
        projectId: placement.projectId,
        position: yield* positionAmong(input.parentId as EntityId, undefined),
        ydoc: jsonToState(json),
        content: json as Record<string, unknown>,
        contentText: text,
        lastEditedBy: createdBy,
        lastEditedAt: new Date(),
      })
      .pipe(Effect.orDie)
    return id
  })
