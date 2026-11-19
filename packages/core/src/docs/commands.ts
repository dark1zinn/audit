/**
 * Doc writes: tree, settings, access grants, versions and import. Every write runs through
 * `Command.make`. Reads live in `docs/queries.ts`; doc comments in `docs/comments.ts`.
 */
import { accessEntries, docs, docVersions, entities } from "@audit/db/schema"
import {
  CreateDocInput,
  CreateVersionInput,
  DeleteDocInput,
  DocAccessInput,
  DocNode,
  DocRevokeInput,
  DocVersion,
  ImportMarkdownInput,
  MoveDocInput,
  RenameDocInput,
  SetDocIconInput,
  SetDocRestrictedInput,
  SetDocReviewInput,
} from "@audit/domain/docs/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { NotFound, ValidationError } from "@audit/domain/errors"
import { DocId, DocVersionId, EntityId, ProjectId } from "@audit/domain/ids"
import type { ResourceAction } from "@audit/domain/permissions"
import { Db } from "@audit/platform/database"
import { and, eq, inArray, isNull } from "drizzle-orm"
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
import type { EntityChanges } from "../entities.ts"
import {
  resolvePrincipal,
  type ResolvedPrincipal,
  type ResolvedRole,
} from "../projects/commands.ts"
import { assertWritable } from "../projects/read.ts"
import { emit, record } from "../trail.ts"
import { importMarkdown, restoreVersion } from "./content.ts"
import { loadDoc, positionAmong, subtreeIds, toNode } from "./read.ts"
import { selectVersions, snapshotDoc, toVersion } from "./versions.ts"
import type { DocChanged } from "@audit/domain/events"

type DocChangeKind = (typeof DocChanged.Type)["kind"]

/** Where a doc placed under `parentId` lives: its project (null in the space), and parent doc. */
interface Scope {
  readonly projectId: ProjectId | null
  readonly parentDocId: DocId | null
}

/** Resolves a doc's parent and checks the new placement is writable. */
const scopeUnder = (parentId: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [parent] = yield* db
      .select({ type: entities.type })
      .from(entities)
      .where(and(eq(entities.id, parentId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (parent?.type === "space") return { projectId: null, parentDocId: null } satisfies Scope
    if (parent?.type === "project") {
      const projectId = parentId as ProjectId
      yield* assertWritable(projectId)
      return { projectId, parentDocId: null } satisfies Scope
    }
    if (parent?.type === "doc") {
      const parentDoc = yield* loadDoc(parentId as DocId)
      if (parentDoc.projectId !== null) yield* assertWritable(parentDoc.projectId)
      return { projectId: parentDoc.projectId, parentDocId: parentDoc.id } satisfies Scope
    }
    return yield* new ValidationError({
      message: "Docs live in a project, the space, or another doc",
      field: "parentId",
    })
  })

/** Authorize a command on the doc named by `input.docId`. */
const onDoc = (action: ResourceAction) => (input: { readonly docId: DocId }) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn(action, input.docId)
  })

/** The creator may delete their own doc as an editor (`doc.delete_own`); others need manager. */
const requireDocDelete = (input: { readonly docId: DocId }) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const userId = actorUserId(yield* CurrentActor)
    const [row] = yield* db
      .select({ createdBy: entities.createdBy })
      .from(entities)
      .where(eq(entities.id, input.docId))
      .pipe(Effect.orDie)
    if (
      userId !== null &&
      row?.createdBy === userId &&
      (yield* authz.can("doc.delete_own", input.docId))
    ) {
      return
    }
    yield* authz.requireOn("doc.delete", input.docId)
  })

/** Checks the version lock, applies entity and doc-row changes, records the trail and emits. */
const changeDoc = (args: {
  readonly docId: DocId
  readonly version?: number | undefined
  readonly action: string
  readonly kind: DocChangeKind
  readonly entity?: EntityChanges
  readonly patch?: Partial<typeof docs.$inferInsert>
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser(args.action)
    const lock = yield* lockEntity(args.docId, "doc")
    yield* checkVersion(lock, args.version, { doc: args.docId })
    const before = yield* loadDoc(args.docId)
    if (before.projectId !== null) yield* assertWritable(before.projectId)
    const version = yield* touchEntity(args.docId, args.entity ?? {})
    if (args.patch !== undefined && Object.keys(args.patch).length > 0) {
      yield* db.update(docs).set(args.patch).where(eq(docs.id, args.docId)).pipe(Effect.orDie)
    }
    yield* record({
      action: args.action,
      entityId: args.docId,
      entityType: "doc",
      projectId: before.projectId,
    })
    yield* emit({
      _tag: "DocChanged",
      kind: args.kind,
      docId: args.docId,
      entityId: args.docId,
      projectId: before.projectId,
      actorId: userId,
      version,
    })
    return toNode(yield* loadDoc(args.docId))
  })

export const createDoc = Command.make("doc.create", {
  input: CreateDocInput,
  output: DocNode,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("doc.create", input.parentId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.create")
      const scope = yield* scopeUnder(input.parentId)
      const position = yield* positionAmong(input.parentId, input.afterId)
      const id = Bun.randomUUIDv7() as DocId
      yield* createEntity({
        id,
        type: "doc",
        title: input.title,
        searchText: input.title,
        parentId: input.parentId,
        projectId: scope.projectId,
      })
      yield* db
        .insert(docs)
        .values({
          id,
          parentDocId: scope.parentDocId,
          projectId: scope.projectId,
          position,
          icon: input.icon ?? null,
          ownerUserId: userId,
        })
        .pipe(Effect.orDie)
      const doc = yield* loadDoc(id)
      yield* record({
        action: "doc.create",
        entityId: id,
        entityType: "doc",
        projectId: scope.projectId,
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "created",
        docId: id,
        entityId: id,
        projectId: scope.projectId,
        actorId: userId,
        version: doc.version,
      })
      return toNode(doc)
    }),
})

export const importDoc = Command.make("doc.import", {
  input: ImportMarkdownInput,
  output: DocNode,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("doc.create", input.parentId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.import")
      const scope = yield* scopeUnder(input.parentId)
      const id = yield* importMarkdown(input, userId)
      const doc = yield* loadDoc(id)
      yield* record({
        action: "doc.import",
        entityId: id,
        entityType: "doc",
        projectId: scope.projectId,
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "created",
        docId: id,
        entityId: id,
        projectId: doc.projectId,
        actorId: userId,
        version: doc.version,
      })
      return toNode(doc)
    }),
})

export const renameDoc = Command.make("doc.rename", {
  input: Schema.Struct({ docId: DocId, ...RenameDocInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.update"),
  run: (input) =>
    changeDoc({
      docId: input.docId,
      version: input.version,
      action: "doc.rename",
      kind: "renamed",
      entity: { title: input.title, searchText: input.title },
    }),
})

export const setDocIcon = Command.make("doc.icon", {
  input: Schema.Struct({ docId: DocId, ...SetDocIconInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.update"),
  run: (input) =>
    changeDoc({
      docId: input.docId,
      version: input.version,
      action: "doc.icon",
      kind: "icon_changed",
      patch: { icon: input.icon },
    }),
})

export const moveDoc = Command.make("doc.move", {
  input: Schema.Struct({ docId: DocId, ...MoveDocInput.fields }),
  output: DocNode,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("doc.move", input.docId)
      yield* authz.requireOn("doc.create", input.parentId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.move")
      const lock = yield* lockEntity(input.docId, "doc")
      yield* checkVersion(lock, input.version, { doc: input.docId })
      const before = yield* loadDoc(input.docId)
      if (before.projectId !== null) yield* assertWritable(before.projectId)
      const below = yield* subtreeIds(input.docId)
      if (below.some((id) => id === input.parentId)) {
        return yield* new ValidationError({
          message: "A doc cannot move into itself",
          field: "parentId",
        })
      }
      const scope = yield* scopeUnder(input.parentId)
      const position = yield* positionAmong(input.parentId, input.afterId)
      const version = yield* touchEntity(input.docId, {
        parentId: input.parentId,
        projectId: scope.projectId,
      })
      yield* db
        .update(docs)
        .set({ parentDocId: scope.parentDocId, projectId: scope.projectId, position })
        .where(eq(docs.id, input.docId))
        .pipe(Effect.orDie)
      const descendants = below.filter((id) => id !== input.docId)
      if (descendants.length > 0) {
        yield* db
          .update(entities)
          .set({ projectId: scope.projectId })
          .where(inArray(entities.id, descendants))
          .pipe(Effect.orDie)
        yield* db
          .update(docs)
          .set({ projectId: scope.projectId })
          .where(inArray(docs.id, descendants))
          .pipe(Effect.orDie)
      }
      yield* record({
        action: "doc.move",
        entityId: input.docId,
        entityType: "doc",
        projectId: scope.projectId,
        details: { from: before.parentId, to: input.parentId },
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "moved",
        docId: input.docId,
        entityId: input.docId,
        projectId: scope.projectId,
        actorId: userId,
        version,
      })
      return toNode(yield* loadDoc(input.docId))
    }),
})

export const deleteDoc = Command.make("doc.delete", {
  input: Schema.Struct({ docId: DocId, ...DeleteDocInput.fields }),
  output: Schema.Void,
  authorize: requireDocDelete,
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.delete")
      const lock = yield* lockEntity(input.docId, "doc")
      yield* checkVersion(lock, input.version, { doc: input.docId })
      const doc = yield* loadDoc(input.docId)
      const ids = yield* subtreeIds(input.docId)
      yield* Effect.forEach(ids, (id) => softDeleteEntity(id), { discard: true })
      yield* record({
        action: "doc.delete",
        entityId: input.docId,
        entityType: "doc",
        projectId: doc.projectId,
        details: { removed: ids.length },
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "deleted",
        docId: input.docId,
        entityId: input.docId,
        projectId: doc.projectId,
        actorId: userId,
        version: lock.version + 1,
      })
    }),
})

export const setDocRestricted = Command.make("doc.restrict", {
  input: Schema.Struct({ docId: DocId, ...SetDocRestrictedInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.settings"),
  run: (input) =>
    changeDoc({
      docId: input.docId,
      version: input.version,
      action: "doc.restrict",
      kind: "restricted",
      entity: { restricted: input.restricted },
    }),
})

export const setDocReview = Command.make("doc.review", {
  input: Schema.Struct({ docId: DocId, ...SetDocReviewInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.settings"),
  run: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      if (input.ownerUserId !== null) {
        const role = yield* authz.workspaceRole(input.ownerUserId)
        if (role === null) {
          return yield* new ValidationError({
            message: "The review owner must be an active member",
            field: "ownerUserId",
          })
        }
      }
      return yield* changeDoc({
        docId: input.docId,
        action: "doc.review",
        kind: "review_changed",
        patch: {
          reviewEveryDays: input.reviewEveryDays,
          ownerUserId: input.ownerUserId,
          reviewNotifiedAt: null,
        },
      })
    }),
})

export const verifyDoc = Command.make("doc.verify", {
  input: Schema.Struct({ docId: DocId }),
  output: DocNode,
  authorize: onDoc("doc.update"),
  run: (input) =>
    changeDoc({
      docId: input.docId,
      action: "doc.verify",
      kind: "verified",
      patch: { verifiedAt: new Date(), reviewNotifiedAt: null },
    }),
})

/** Matches the access row for one principal on one doc. */
const principalMatch = (docId: DocId, principal: ResolvedPrincipal | ResolvedRole) =>
  principal.principalType === "role"
    ? and(
        eq(accessEntries.resourceId, docId),
        eq(accessEntries.principalType, "role"),
        eq(accessEntries.principalRole, principal.principalRole),
      )
    : and(
        eq(accessEntries.resourceId, docId),
        eq(accessEntries.principalType, principal.principalType),
        eq(accessEntries.principalId, principal.principalId),
      )

export const grantDocAccess = Command.make("doc.access.grant", {
  input: Schema.Struct({ docId: DocId, ...DocAccessInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.manage_access"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.access.grant")
      const principal = yield* resolvePrincipal(input)
      yield* db
        .delete(accessEntries)
        .where(principalMatch(input.docId, principal))
        .pipe(Effect.orDie)
      yield* db
        .insert(accessEntries)
        .values({
          resourceId: input.docId,
          principalType: principal.principalType,
          principalId: principal.principalId,
          principalRole: principal.principalRole,
          role: input.role,
          grantedBy: userId,
        })
        .pipe(Effect.orDie)
      const doc = yield* loadDoc(input.docId)
      yield* record({
        action: "doc.access.grant",
        entityId: input.docId,
        entityType: "doc",
        projectId: doc.projectId,
        details: { principalType: input.principalType, role: input.role },
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "access_changed",
        docId: input.docId,
        entityId: input.docId,
        projectId: doc.projectId,
        actorId: userId,
        version: doc.version,
      })
      return toNode(doc)
    }),
})

export const revokeDocAccess = Command.make("doc.access.revoke", {
  input: Schema.Struct({ docId: DocId, ...DocRevokeInput.fields }),
  output: DocNode,
  authorize: onDoc("doc.manage_access"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("doc.access.revoke")
      const principal = yield* resolvePrincipal(input)
      yield* db
        .delete(accessEntries)
        .where(principalMatch(input.docId, principal))
        .pipe(Effect.orDie)
      const doc = yield* loadDoc(input.docId)
      yield* record({
        action: "doc.access.revoke",
        entityId: input.docId,
        entityType: "doc",
        projectId: doc.projectId,
        details: { principalType: input.principalType },
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "access_changed",
        docId: input.docId,
        entityId: input.docId,
        projectId: doc.projectId,
        actorId: userId,
        version: doc.version,
      })
      return toNode(doc)
    }),
})

export const createDocVersion = Command.make("doc.version.create", {
  input: Schema.Struct({ docId: DocId, ...CreateVersionInput.fields }),
  output: DocVersion,
  authorize: onDoc("doc.update"),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.version.create")
      const doc = yield* loadDoc(input.docId)
      const number = yield* snapshotDoc(input.docId, "named", input.label, userId)
      const [row] = yield* selectVersions(
        and(eq(docVersions.docId, input.docId), eq(docVersions.version, number)),
      )
      if (row === undefined) return yield* new NotFound({ entity: "doc_version", id: input.docId })
      yield* record({
        action: "doc.version.create",
        entityId: input.docId,
        entityType: "doc",
        projectId: doc.projectId,
        details: { version: number },
      })
      yield* emit({
        _tag: "DocChanged",
        kind: "version_created",
        docId: input.docId,
        entityId: input.docId,
        projectId: doc.projectId,
        actorId: userId,
        version: doc.version,
      })
      return toVersion(row)
    }),
})

export const restoreDocVersion = Command.make("doc.version.restore", {
  input: Schema.Struct({ docId: DocId, versionId: DocVersionId }),
  output: DocNode,
  authorize: onDoc("doc.update"),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("doc.version.restore")
      const doc = yield* loadDoc(input.docId)
      if (doc.projectId !== null) yield* assertWritable(doc.projectId)
      const [row] = yield* selectVersions(
        and(eq(docVersions.id, input.versionId), eq(docVersions.docId, input.docId)),
      )
      if (row === undefined)
        return yield* new NotFound({ entity: "doc_version", id: input.versionId })
      yield* restoreVersion(input.versionId, userId)
      return toNode(yield* loadDoc(input.docId))
    }),
})
