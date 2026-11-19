import { queryOptions } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { EntityRef } from "@audit/domain/docs/schema"
import type { DocId, DocVersionId, EntityId, ProjectId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"

/** Keys for doc data. Realtime `DocChanged` events invalidate these by prefix (see `realtime.ts`). */
export const docKeys = {
  space: ["docs", "space"] as const,
  project: (projectId: ProjectId) => ["docs", "project", projectId] as const,
  doc: (docId: DocId) => ["doc", docId] as const,
  versions: (docId: DocId) => ["doc-versions", docId] as const,
  version: (docId: DocId, versionId: DocVersionId) =>
    ["doc-versions", docId, "content", versionId] as const,
  comments: (docId: DocId) => ["doc-comments", docId] as const,
  backlinks: (entityId: EntityId) => ["backlinks", entityId] as const,
  entity: (entityId: EntityId) => ["entity-refs", entityId] as const,
}

/** Docs in the workspace space (no project). */
export const spaceTreeQuery = queryOptions({
  queryKey: docKeys.space,
  queryFn: () => callApi((api) => api.docs.spaceTree()),
})

/** Doc tree for a project, or the workspace space when `projectId` is null. */
export const docTreeQuery = (projectId: ProjectId | null) =>
  queryOptions({
    queryKey: projectId === null ? docKeys.space : docKeys.project(projectId),
    queryFn: () =>
      projectId === null
        ? callApi((api) => api.docs.spaceTree())
        : callApi((api) => api.docs.projectTree({ params: { projectId } })),
  })

export const projectTreeQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: docKeys.project(projectId),
    queryFn: () => callApi((api) => api.docs.projectTree({ params: { projectId } })),
  })

export const docQuery = (docId: DocId) =>
  queryOptions({
    queryKey: docKeys.doc(docId),
    queryFn: () => callApi((api) => api.docs.get({ params: { docId } })),
    retry: false,
  })

export const versionsQuery = (docId: DocId) =>
  queryOptions({
    queryKey: docKeys.versions(docId),
    queryFn: () => callApi((api) => api.docs.versions({ params: { docId } })),
  })

export const versionQuery = (docId: DocId, versionId: DocVersionId) =>
  queryOptions({
    queryKey: docKeys.version(docId, versionId),
    queryFn: () => callApi((api) => api.docs.version({ params: { docId, versionId } })),
  })

export const commentsQuery = (docId: DocId) =>
  queryOptions({
    queryKey: docKeys.comments(docId),
    queryFn: () => callApi((api) => api.docs.comments({ params: { docId } })),
  })

export const backlinksQuery = (entityId: EntityId) =>
  queryOptions({
    queryKey: docKeys.backlinks(entityId),
    queryFn: () => callApi((api) => api.entities.backlinks({ params: { entityId } })),
  })

/** Refreshes everything a doc edit or version change touches. */
export const invalidateDoc = (queryClient: QueryClient, docId: DocId) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["docs"] }),
    queryClient.invalidateQueries({ queryKey: docKeys.doc(docId) }),
    queryClient.invalidateQueries({ queryKey: ["doc-versions", docId] }),
    queryClient.invalidateQueries({ queryKey: ["doc-comments", docId] }),
  ])

type PendingRef = {
  readonly resolve: (ref: EntityRef | null) => void
  readonly reject: (error: unknown) => void
}

/** Ids waiting for the next batch, each with the promise callbacks of its caller. */
const pendingRefs = new Map<string, PendingRef[]>()
let flushScheduled = false

const flushRefs = () => {
  flushScheduled = false
  const batch = [...pendingRefs.entries()]
  pendingRefs.clear()
  if (batch.length === 0) return
  const ids = batch.map(([id]) => id as EntityId)
  callApi((api) => api.entities.resolve({ payload: { ids } }))
    .then((found) => {
      for (const [id, waiters] of batch) {
        for (const waiter of waiters) waiter.resolve(found[id] ?? null)
      }
    })
    .catch((error: unknown) => {
      for (const [, waiters] of batch) for (const waiter of waiters) waiter.reject(error)
    })
}

/** One entity lookup, batched with the other lookups made in the same tick (max 200 per call). */
const resolveRef = (entityId: EntityId): Promise<EntityRef | null> => {
  const { promise, resolve, reject } = Promise.withResolvers<EntityRef | null>()
  const waiters = pendingRefs.get(entityId) ?? []
  waiters.push({ resolve, reject })
  pendingRefs.set(entityId, waiters)
  if (!flushScheduled) {
    flushScheduled = true
    setTimeout(flushRefs, 10)
  }
  return promise
}

/** A mention or link target. `null` when the server has no such entity. */
export const entityRefQuery = (entityId: EntityId) =>
  queryOptions({
    queryKey: docKeys.entity(entityId),
    queryFn: () => resolveRef(entityId),
    staleTime: 60_000,
  })
