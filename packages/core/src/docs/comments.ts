/**
 * Anchored comment threads on a doc. Comments reuse the `comments` table with the doc as target.
 * Each comment is an entity so it gets versions, trail and soft delete like everything else.
 */
import { comments, entities } from "@audit/db/schema"
import { CreateDocCommentInput, DocComment, UpdateDocCommentInput } from "@audit/domain/docs/schema"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { CommentId, DocId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { Authz } from "../authz.ts"
import { currentUser } from "../current-user.ts"
import {
  checkVersion,
  createEntity,
  lockEntity,
  softDeleteEntity,
  touchEntity,
} from "../entities.ts"
import { plainText } from "../notifications/notify.ts"
import { emit, record } from "../trail.ts"
import { assertWritable } from "../projects/read.ts"
import { loadDoc } from "./read.ts"

/** Live comments on a doc, oldest first. */
export const listDocComments = (docId: DocId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", docId)
    const rows = yield* db
      .select({ id: comments.id })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(eq(comments.targetId, docId), isNull(entities.deletedAt)))
      .orderBy(asc(entities.createdAt))
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, (row) => loadDocComment(row.id as CommentId))
  })

/** One live comment with its entity version and timestamps. */
const loadDocComment = (commentId: CommentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: comments.id,
        docId: comments.targetId,
        authorId: comments.authorId,
        anchor: comments.anchor,
        body: comments.body,
        bodyText: comments.bodyText,
        parentCommentId: comments.parentCommentId,
        resolvedAt: comments.resolvedAt,
        editedAt: comments.editedAt,
        createdAt: entities.createdAt,
        version: entities.version,
      })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(eq(comments.id, commentId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "comment", id: commentId })
    return {
      id: row.id as CommentId,
      docId: row.docId as DocId,
      authorId: row.authorId as UserId,
      body: row.body,
      bodyText: row.bodyText,
      anchor: row.anchor,
      parentCommentId: row.parentCommentId as CommentId | null,
      resolvedAt: row.resolvedAt,
      editedAt: row.editedAt,
      createdAt: row.createdAt,
      version: row.version,
    } satisfies typeof DocComment.Type
  })

/** The doc and author a comment belongs to, for authorization. */
const commentTarget = (commentId: CommentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ docId: comments.targetId, authorId: comments.authorId })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(eq(comments.id, commentId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "comment", id: commentId })
    return { docId: row.docId as DocId, authorId: row.authorId as UserId }
  })

export const createDocComment = Command.make("doc.comment.create", {
  input: Schema.Struct({ docId: DocId, ...CreateDocCommentInput.fields }),
  output: DocComment,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("doc.comment", input.docId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.comment.create")
      const doc = yield* loadDoc(input.docId)
      if (doc.projectId !== null) yield* assertWritable(doc.projectId)
      if (input.parentCommentId !== undefined && input.parentCommentId !== null) {
        const [parent] = yield* db
          .select({ id: comments.id })
          .from(comments)
          .where(and(eq(comments.id, input.parentCommentId), eq(comments.targetId, input.docId)))
          .pipe(Effect.orDie)
        if (parent === undefined) {
          return yield* new ValidationError({
            message: "Parent comment must be on this doc",
            field: "parentCommentId",
          })
        }
      }
      const id = (yield* createEntity({
        type: "comment",
        title: "",
        parentId: input.docId,
        projectId: doc.projectId,
      })) as CommentId
      yield* db
        .insert(comments)
        .values({
          id,
          targetId: input.docId,
          authorId: userId,
          anchor: input.anchor ?? null,
          body: input.body,
          bodyText: plainText(input.body),
          parentCommentId: input.parentCommentId ?? null,
        })
        .pipe(Effect.orDie)
      yield* record({
        action: "doc.comment.create",
        entityId: id,
        entityType: "comment",
        projectId: doc.projectId,
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "comment_created",
        docId: input.docId,
        entityId: id,
        projectId: doc.projectId,
        actorId: userId,
        version: 1,
      })
      return yield* loadDocComment(id)
    }),
})

export const updateDocComment = Command.make("doc.comment.update", {
  input: Schema.Struct({ commentId: CommentId, ...UpdateDocCommentInput.fields }),
  output: DocComment,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("doc.comment.update")
      const target = yield* commentTarget(input.commentId)
      if (input.body !== undefined && target.authorId !== userId) {
        return yield* new Forbidden({
          action: "doc.comment.update",
          message: "Only the author can edit this comment",
        })
      }
      yield* authz.requireOn("doc.comment", target.docId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.comment.update")
      const target = yield* commentTarget(input.commentId)
      const doc = yield* loadDoc(target.docId)
      const lock = yield* lockEntity(input.commentId, "comment")
      yield* checkVersion(lock, input.version, { comment: input.commentId })
      if (doc.projectId !== null) yield* assertWritable(doc.projectId)
      if (input.body !== undefined) {
        yield* db
          .update(comments)
          .set({ body: input.body, bodyText: plainText(input.body), editedAt: new Date() })
          .where(eq(comments.id, input.commentId))
          .pipe(Effect.orDie)
      }
      if (input.resolved !== undefined) {
        yield* db
          .update(comments)
          .set({ resolvedAt: input.resolved ? new Date() : null })
          .where(eq(comments.id, input.commentId))
          .pipe(Effect.orDie)
      }
      const version = yield* touchEntity(input.commentId, {})
      yield* emit({
        _tag: "DocChanged",
        kind: "comment_updated",
        docId: target.docId,
        entityId: input.commentId,
        projectId: doc.projectId,
        actorId: userId,
        version,
      })
      return yield* loadDocComment(input.commentId)
    }),
})

export const deleteDocComment = Command.make("doc.comment.delete", {
  input: Schema.Struct({ commentId: CommentId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("doc.comment.delete")
      const target = yield* commentTarget(input.commentId)
      if (target.authorId === userId) {
        yield* authz.requireOn("doc.comment", target.docId)
        return
      }
      yield* authz.requireOn("doc.delete", target.docId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.comment.delete")
      const target = yield* commentTarget(input.commentId)
      const doc = yield* loadDoc(target.docId)
      if (doc.projectId !== null) yield* assertWritable(doc.projectId)
      yield* softDeleteEntity(input.commentId)
      yield* record({
        action: "doc.comment.delete",
        entityId: input.commentId,
        entityType: "comment",
        projectId: doc.projectId,
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "comment_deleted",
        docId: target.docId,
        entityId: input.commentId,
        projectId: doc.projectId,
        actorId: userId,
        version: null,
      })
    }),
})
