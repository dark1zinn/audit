/**
 * Doc upkeep. When a task, message or event that a doc links to changes, the model reads the doc
 * against the changed sources and proposes exact-text fixes as AI-tagged comments on the doc. Nothing
 * edits a doc on its own: a person accepts a suggestion, which applies it as that person, or
 * dismisses it. Jobs are debounced per doc so a burst of source edits runs one review.
 */
import { comments, docs, entities, references, user } from "@audit/db/schema"
import type { DomainEvent } from "@audit/domain/events"
import { Conflict, NotFound } from "@audit/domain/errors"
import { CommentId, DocId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob, Jobs } from "@audit/platform/jobs"
import { jsonToState } from "@audit/editor/ydoc"
import { isJsonNode, type JsonNode } from "@audit/editor/json"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect, Schema, Stream } from "effect"
import { visibleTo } from "../access.ts"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { createEntity } from "../entities.ts"
import { EventBus } from "../event-bus.ts"
import { saveDocContent } from "../docs/content.ts"
import { record } from "../trail.ts"
import { generateStructured } from "./generate.ts"

/** Quiet period before a doc is reviewed after a linked source changed. */
export const DOC_UPKEEP_DEBOUNCE_SECONDS = 60

/** Most suggestions one review may propose. */
const MAX_FINDINGS = 5

/** Characters of doc and source text sent to the model. */
const PROMPT_LIMIT = 20000

export const docUpkeepJob = defineJob("ai.doc-upkeep", Schema.Struct({ docId: Schema.String }))

const Finding = Schema.Struct({
  quote: Schema.String,
  replacement: Schema.String,
  reason: Schema.String,
})

const Findings = Schema.Struct({ findings: Schema.Array(Finding) })

/** Replaces the first occurrence of `quote` inside one text node. Null when it is not there. */
export const replaceFirst = (
  node: JsonNode,
  quote: string,
  replacement: string,
): JsonNode | null => {
  if (typeof node.text === "string") {
    const at = node.text.indexOf(quote)
    if (at < 0) return null
    return {
      ...node,
      text: node.text.slice(0, at) + replacement + node.text.slice(at + quote.length),
    }
  }
  const children = node.content ?? []
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if (child === undefined) continue
    const updated = replaceFirst(child, quote, replacement)
    if (updated !== null) {
      return { ...node, content: children.map((item, at) => (at === index ? updated : item)) }
    }
  }
  return null
}

const docsLinkedTo = (entityId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db
      .selectDistinct({ id: docs.id })
      .from(references)
      .innerJoin(docs, eq(docs.id, references.sourceId))
      .where(eq(references.targetId, entityId))
      .pipe(Effect.orDie)
  })

/** Enqueues the debounced review for every doc that links to a changed source. */
export const scheduleDocUpkeep = (event: DomainEvent) =>
  Effect.gen(function* () {
    if (
      event._tag !== "TaskChanged" &&
      event._tag !== "MessageChanged" &&
      event._tag !== "EventChanged"
    ) {
      return
    }
    const jobs = yield* Jobs
    if (event.entityId === null) return
    for (const doc of yield* docsLinkedTo(event.entityId)) {
      yield* jobs.enqueue(
        docUpkeepJob,
        { docId: doc.id },
        {
          singletonKey: `doc-upkeep:${doc.id}`,
          singletonSeconds: DOC_UPKEEP_DEBOUNCE_SECONDS,
          startAfter: DOC_UPKEEP_DEBOUNCE_SECONDS,
        },
      )
    }
  })

/** Forks the subscriber that schedules doc reviews. Lives as long as the scope. */
export const startDocUpkeepIndexer = Effect.gen(function* () {
  const bus = yield* EventBus
  const events = yield* bus.subscribe
  yield* events.pipe(
    Stream.runForEach((event) =>
      scheduleDocUpkeep(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("doc upkeep scheduling failed", cause)),
      ),
    ),
    Effect.forkScoped,
  )
})

/** Writes one open suggestion as an AI-tagged comment on the doc. */
const createSuggestion = Command.make("doc.upkeep.suggest", {
  input: Schema.Struct({
    docId: Schema.String,
    authorId: Schema.String,
    quote: Schema.String,
    replacement: Schema.String,
    reason: Schema.String,
  }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const docId = input.docId as DocId
      const [doc] = yield* db
        .select({ projectId: docs.projectId })
        .from(docs)
        .where(eq(docs.id, docId))
        .pipe(Effect.orDie)
      if (doc === undefined) return
      const id = (yield* createEntity({
        type: "comment",
        title: "",
        searchText: input.reason,
        parentId: docId,
        projectId: doc.projectId as ProjectId | null,
      })) as CommentId
      const body = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: input.reason }] }],
      }
      yield* db
        .insert(comments)
        .values({
          id,
          targetId: docId,
          authorId: input.authorId as UserId,
          anchor: { quote: input.quote },
          body,
          bodyText: input.reason,
          ai: {
            kind: "doc_upkeep",
            status: "open",
            quote: input.quote,
            replacement: input.replacement,
            reason: input.reason,
          },
        })
        .pipe(Effect.orDie)
      yield* record({
        action: "doc.ai_suggested",
        entityId: docId,
        entityType: "doc",
        projectId: doc.projectId as ProjectId | null,
        details: { commentId: id },
      })
    }),
})

/**
 * Sources the upkeep may cite: live targets the author can see and that every reader of the doc
 * can see too, so a finding never reveals a source to someone who could not read it.
 */
const sourcesOf = (docId: string, authorId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const readers = yield* db
      .select({ id: user.id })
      .from(user)
      .where(visibleTo(sql`${user.id}`, sql`${docId}`))
      .pipe(Effect.orDie)
    const candidates = yield* db
      .select({
        id: entities.id,
        title: entities.title,
        searchText: entities.searchText,
      })
      .from(references)
      .innerJoin(entities, eq(entities.id, references.targetId))
      .where(
        and(
          eq(references.sourceId, docId),
          isNull(entities.deletedAt),
          visibleTo(authorId, sql`${entities.id}`),
        ),
      )
      .pipe(Effect.orDie)
    if (candidates.length === 0) return []
    const ids = candidates.map((row) => row.id)
    let allowed = new Set(ids)
    for (const reader of readers) {
      const seen = yield* db
        .select({ id: entities.id })
        .from(entities)
        .where(and(inArray(entities.id, ids), visibleTo(sql`${reader.id}`, sql`${entities.id}`)))
        .pipe(Effect.orDie)
      const readable = new Set(seen.map((row) => row.id))
      allowed = new Set([...allowed].filter((id) => readable.has(id)))
    }
    return candidates
      .filter((row) => allowed.has(row.id))
      .slice(0, 10)
      .map((row) => ({ title: row.title, searchText: row.searchText }))
  })

const buildPrompt = (
  docText: string,
  sources: ReadonlyArray<{ readonly title: string; readonly searchText: string }>,
) =>
  [
    "You review a document against the linked items it cites. Propose at most " +
      `${MAX_FINDINGS} edits where the document is now out of date with a source.`,
    "Each `quote` must be an exact, contiguous excerpt of the document text, inside one sentence.",
    "Return an empty list when nothing is out of date. Do not invent facts.",
    "",
    "<document>",
    docText.slice(0, PROMPT_LIMIT),
    "</document>",
    "",
    ...sources.map(
      (source) => `<source title="${source.title}">${source.searchText.slice(0, 2000)}</source>`,
    ),
  ].join("\n")

/**
 * Reviews one doc. Runs as the system actor; does nothing when AI is off for the review, the doc
 * has no author to attribute suggestions to, or no linked sources remain.
 */
export const reviewDoc = (docId: DocId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [doc] = yield* db
      .select({
        content: docs.content,
        contentText: docs.contentText,
        lastEditedBy: docs.lastEditedBy,
        ownerUserId: docs.ownerUserId,
      })
      .from(docs)
      .innerJoin(entities, eq(entities.id, docs.id))
      .where(and(eq(docs.id, docId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (doc === undefined || !isJsonNode(doc.content)) return
    const authorId = doc.lastEditedBy ?? doc.ownerUserId
    const content = doc.content
    if (authorId === null) return
    const sources = yield* sourcesOf(docId, authorId as UserId)
    if (sources.length === 0) return
    const generated = yield* generateStructured(
      authorId as UserId,
      "doc_upkeep",
      buildPrompt(doc.contentText, sources),
      Findings,
    ).pipe(
      Effect.catch((error) => Effect.logInfo("doc upkeep skipped", error).pipe(Effect.as(null))),
    )
    if (generated === null) return
    const open = yield* db
      .select({ quote: sql<string>`${comments.ai}->>'quote'` })
      .from(comments)
      .where(
        and(
          eq(comments.targetId, docId),
          sql`${comments.ai}->>'kind' = 'doc_upkeep'`,
          sql`${comments.ai}->>'status' = 'open'`,
        ),
      )
      .pipe(Effect.orDie)
    const openQuotes = new Set(open.map((row) => row.quote))
    const usable = generated.findings
      .filter((finding) => !openQuotes.has(finding.quote))
      .filter((finding) => replaceFirst(content, finding.quote, finding.replacement) !== null)
      .slice(0, MAX_FINDINGS)
    for (const finding of usable) {
      yield* createSuggestion.execute({ docId, authorId, ...finding })
    }
  })

export const docUpkeep = Command.make("doc.upkeep.run", {
  input: Schema.Struct({ docId: Schema.String }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ docId }) => reviewDoc(docId as DocId),
})

/** Loads an AI suggestion comment on a doc, failing when it is missing or not a suggestion. */
const loadSuggestion = (commentId: CommentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        targetId: comments.targetId,
        ai: comments.ai,
      })
      .from(comments)
      .where(eq(comments.id, commentId))
      .pipe(Effect.orDie)
    if (row === undefined || row.ai === null || row.ai["kind"] !== "doc_upkeep") {
      return yield* new NotFound({ entity: "doc_suggestion", id: commentId })
    }
    return { docId: row.targetId as DocId, ai: row.ai }
  })

const openOnly = (ai: Record<string, unknown>) =>
  ai["status"] === "open"
    ? Effect.void
    : Effect.fail(new Conflict({ message: "This suggestion is already resolved" }))

/**
 * Applies a suggestion to the doc as the accepting person. The edit goes through the normal doc
 * save, so the person's permission, the trail and the live update all apply.
 */
export const acceptDocSuggestion = Command.make("doc.upkeep.accept", {
  input: Schema.Struct({ commentId: Schema.String }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ commentId }) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.upkeep.accept")
      const authz = yield* Authz
      const id = commentId as CommentId
      const suggestion = yield* loadSuggestion(id)
      yield* authz.requireOn("doc.update", suggestion.docId)
      yield* openOnly(suggestion.ai)
      const db = yield* Db
      const [doc] = yield* db
        .select({ content: docs.content, projectId: docs.projectId })
        .from(docs)
        .where(eq(docs.id, suggestion.docId))
        .pipe(Effect.orDie)
      if (doc === undefined || !isJsonNode(doc.content)) {
        return yield* new NotFound({ entity: "doc", id: suggestion.docId })
      }
      const quote = String(suggestion.ai["quote"])
      const replacement = String(suggestion.ai["replacement"])
      const updated = replaceFirst(doc.content, quote, replacement)
      if (updated === null) {
        return yield* new Conflict({
          message: "The text has changed since this suggestion; dismiss it instead",
        })
      }
      yield* saveDocContent.execute({
        docId: suggestion.docId,
        ydocState: jsonToState(updated),
      })
      yield* db
        .update(comments)
        .set({
          ai: { ...suggestion.ai, status: "accepted", acceptedBy: userId },
          resolvedAt: new Date(),
        })
        .where(eq(comments.id, id))
        .pipe(Effect.orDie)
      yield* record({
        action: "doc.ai_edit_accepted",
        entityId: suggestion.docId,
        entityType: "doc",
        projectId: doc.projectId as ProjectId | null,
        details: { commentId: id, quote, replacement },
      })
    }),
})

/** Resolves a suggestion without touching the doc. */
export const dismissDocSuggestion = Command.make("doc.upkeep.dismiss", {
  input: Schema.Struct({ commentId: Schema.String }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ commentId }) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.upkeep.dismiss")
      const authz = yield* Authz
      const id = commentId as CommentId
      const suggestion = yield* loadSuggestion(id)
      yield* authz.requireOn("doc.comment", suggestion.docId)
      yield* openOnly(suggestion.ai)
      const db = yield* Db
      yield* db
        .update(comments)
        .set({
          ai: { ...suggestion.ai, status: "dismissed", dismissedBy: userId },
          resolvedAt: new Date(),
        })
        .where(eq(comments.id, id))
        .pipe(Effect.orDie)
      yield* record({
        action: "doc.ai_suggestion_dismissed",
        entityId: suggestion.docId,
        entityType: "doc",
        details: { commentId: id },
      })
    }),
})
