import { useLingui } from "@lingui/react/macro"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarWorkspace } from "../components/calendar/calendar-workspace.tsx"
import { PageHeader } from "../components/feedback.tsx"

export const Route = createFileRoute("/_app/calendar")({
  validateSearch: (search: Record<string, unknown>): { readonly new?: string } =>
    typeof search["new"] === "string" ? { new: search["new"] } : {},
  component: CalendarPage,
})

function CalendarPage() {
  const { t } = useLingui()
  const { me } = Route.useRouteContext()
  const { new: newRequest } = Route.useSearch()
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
      />
    </div>
  )
}
