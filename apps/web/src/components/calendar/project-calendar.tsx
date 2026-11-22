import type { ProjectId } from "@audit/domain/ids"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { CalendarWorkspace } from "./calendar-workspace.tsx"

/** Project Calendar tab: the project's calendars, their events and the project's task due dates. */
export function ProjectCalendar({
  projectId,
  timezone,
  userId,
  filter,
  eventParam,
  dateParam,
  onEventParamDone,
}: {
  readonly projectId: ProjectId
  readonly timezone: string
  readonly userId: string
  readonly filter: ListTasksQuery
  readonly eventParam?: string | undefined
  readonly dateParam?: string | undefined
  readonly onEventParamDone?: (() => void) | undefined
}) {
  return (
    <CalendarWorkspace
      scope={{ kind: "project", projectId }}
      timezone={timezone}
      userId={userId}
      filter={filter}
      eventParam={eventParam}
      dateParam={dateParam}
      onEventParamDone={onEventParamDone}
    />
  )
}
