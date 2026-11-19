import { useLingui } from "@lingui/react/macro"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarWorkspace } from "../components/calendar/calendar-workspace.tsx"
import { PageHeader } from "../components/feedback.tsx"

export const Route = createFileRoute("/_app/calendar")({
  component: CalendarPage,
})

function CalendarPage() {
  const { t } = useLingui()
  const { me } = Route.useRouteContext()
  return (
    <div className="space-y-6">
      <PageHeader
        title={t`Calendar`}
        description={t`Your events, shared calendars and task due dates.`}
      />
      <CalendarWorkspace scope={{ kind: "all" }} timezone={me.timezone} userId={me.userId} />
    </div>
  )
}
