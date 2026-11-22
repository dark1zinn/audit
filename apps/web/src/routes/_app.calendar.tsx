import { useLingui } from "@lingui/react/macro"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarWorkspace } from "../components/calendar/calendar-workspace.tsx"
import { parseCalendarSearch } from "../components/calendar/calendar-search.ts"
import { PageHeader } from "../components/feedback.tsx"

export const Route = createFileRoute("/_app/calendar")({
  validateSearch: parseCalendarSearch,
  component: CalendarPage,
})

function CalendarPage() {
  const { t } = useLingui()
  const { me } = Route.useRouteContext()
  const { new: newRequest, event: eventParam, date: dateParam } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <div className="space-y-6">
      <PageHeader
        title={t`Calendar`}
        description={t`Your events, shared calendars and task due dates.`}
      />
      <CalendarWorkspace
        key={newRequest ?? "none"}
        scope={{ kind: "all" }}
        timezone={me.timezone}
        userId={me.userId}
        newRequest={newRequest}
        eventParam={eventParam}
        dateParam={dateParam}
        onEventParamDone={() =>
          void navigate({ search: (prev) => ({ ...prev, event: undefined }), replace: true })
        }
      />
    </div>
  )
}
