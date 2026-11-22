import type { ActionGroup, EntityTarget } from "./types.ts"
import { useCalendarActions } from "./calendar-actions.ts"
import { useChannelActions } from "./channel-actions.ts"
import { useDocActions } from "./doc-actions.ts"
import { useEntityRefActions } from "./entity-ref-actions.ts"
import { useEventActions } from "./event-actions.ts"
import { useMemberActions } from "./member-actions.ts"
import { useMessageActions } from "./message-actions.ts"
import { useNotificationActions } from "./notification-actions.ts"
import { useProjectActions } from "./project-actions.ts"
import { useTaskActions } from "./task-actions.ts"

/**
 * Action groups for an entity. `open` is false until a menu is shown, so
 * hooks that fetch detail data (doc role, task columns) stay idle until then.
 * Every kind hook runs on each render; hooks for other kinds receive `null`.
 */
export const useEntityActions = (
  target: EntityTarget | null,
  open: boolean,
): ReadonlyArray<ActionGroup> => {
  const task = useTaskActions(target?.kind === "task" ? target : null, open)
  const doc = useDocActions(target?.kind === "doc" ? target : null, open)
  const project = useProjectActions(target?.kind === "project" ? target : null)
  const channel = useChannelActions(target?.kind === "channel" ? target : null)
  const message = useMessageActions(target?.kind === "message" ? target : null)
  const event = useEventActions(target?.kind === "event" ? target : null)
  const member = useMemberActions(target?.kind === "member" ? target : null)
  const notification = useNotificationActions(target?.kind === "notification" ? target : null)
  const calendar = useCalendarActions(target?.kind === "calendar" ? target : null)
  const entityRef = useEntityRefActions(target?.kind === "entity" ? target : null)

  if (target === null) return []
  switch (target.kind) {
    case "task":
      return task
    case "doc":
      return doc
    case "project":
      return project
    case "channel":
      return channel
    case "message":
      return message
    case "event":
      return event
    case "member":
      return member
    case "notification":
      return notification
    case "calendar":
      return calendar
    case "entity":
      return entityRef
  }
}
