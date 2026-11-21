import type { EntityRef } from "@audit/domain/docs/schema"

/** Route for a task; `number` is the task number within its project. */
export const taskHref = (projectKey: string, number: number | string) =>
  `/p/${projectKey}/t/${number}`

/** Route for a doc; project docs live under their project, space docs under `/docs`. */
export const docHref = (id: string, projectKey: string | null) =>
  projectKey === null ? `/docs/${id}` : `/p/${projectKey}/docs/${id}`

/** Route for a channel. */
export const channelHref = (channelId: string) => `/c/${channelId}`

/** Route for a message, opened as its thread. */
export const messageHref = (channelId: string, messageId: string) =>
  `/c/${channelId}/t/${messageId}`

/**
 * Route for an entity reference, or `undefined` when it has no page
 * (restricted, deleted, or a type without a route such as teams).
 */
export const entityHref = (ref: EntityRef): string | undefined => {
  if (ref.restricted || ref.deleted) return undefined
  switch (ref.type) {
    case "task":
      return ref.projectKey !== undefined && ref.number !== undefined
        ? taskHref(ref.projectKey, ref.number)
        : undefined
    case "doc":
      return docHref(ref.id, ref.projectKey ?? null)
    case "project":
    case "board":
      return ref.projectKey !== undefined ? `/p/${ref.projectKey}/board` : undefined
    case "channel":
      return channelHref(ref.id)
    case "message":
      return ref.channelId !== undefined ? messageHref(ref.channelId, ref.id) : undefined
    case "event":
      return ref.startsAt !== undefined
        ? `/calendar?event=${ref.id}&date=${ref.startsAt.slice(0, 10)}`
        : `/calendar?event=${ref.id}`
    case "user":
      return `/dm/${ref.id}`
    default:
      return undefined
  }
}
