/**
 * Doc reads: project and space trees, one doc with the caller's role, versions and export.
 * Single-item reads check `doc.read` on the doc; lists filter with `authz.visible`.
 */
import { docs, docVersions, entities } from "@audit/db/schema"
import type { ExportFormat } from "@audit/domain/docs/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound } from "@audit/domain/errors"
import type { DocId, DocVersionId, ProjectId } from "@audit/domain/ids"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { exportDoc as exportContent } from "./content.ts"
import { loadDoc, selectDocs, toNode } from "./read.ts"
import { selectVersions, toVersion, toVersionContent } from "./versions.ts"

/** Live docs of one project the caller may see, in tree order. */
export const projectTree = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)
    const rows = yield* selectDocs(and(eq(docs.projectId, projectId), visible))
    return rows.map(toNode)
  })

/** Live workspace-space docs the caller may see, in tree order. */
export const spaceTree = () =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)
    const rows = yield* selectDocs(and(isNull(docs.projectId), visible))
    return rows.map(toNode)
  })

/** One doc with the caller's role on it (null for system and AI actors). */
export const getDoc = (docId: DocId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", docId)
    const doc = yield* loadDoc(docId)
    const userId = actorUserId(yield* CurrentActor)
    if (userId === null) {
      return yield* new Forbidden({ action: "doc.read", message: "Only users have a doc role" })
    }
    const myRole = yield* authz.roleOn(userId, docId)
    if (myRole === null) return yield* new NotFound({ entity: "doc", id: docId })
    return { ...toNode(doc), myRole }
  })

/** Version history of a doc, newest first. */
export const listVersions = (docId: DocId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", docId)
    const rows = yield* selectVersions(eq(docVersions.docId, docId))
    return rows.map(toVersion)
  })

/** One version of a doc, with its content for diffing. */
export const getVersion = (docId: DocId, versionId: DocVersionId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", docId)
    const [row] = yield* selectVersions(
      and(eq(docVersions.id, versionId), eq(docVersions.docId, docId)),
    )
    if (row === undefined) {
      return yield* new NotFound({ entity: "doc_version", id: versionId })
    }
    return toVersionContent(row)
  })

/** Exports a doc as Markdown or HTML. */
export const exportDoc = (docId: DocId, format: ExportFormat) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", docId)
    return yield* exportContent(docId, format)
  })
