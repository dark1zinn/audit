import { createFileRoute } from "@tanstack/react-router"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { ProjectCalendar } from "../components/calendar/project-calendar.tsx"
import { TaskFilterBar } from "../components/list/task-filter-bar.tsx"
import { parseTaskSearch, withTaskSearch } from "../components/list/task-search.ts"
import { WithProject } from "../components/list/with-project.tsx"

export const Route = createFileRoute("/_app/p/$key/calendar")({
  validateSearch: parseTaskSearch,
  component: CalendarPage,
})

function CalendarPage() {
  const { key } = Route.useParams()
  return (
    <WithProject projectKey={key}>{(project) => <CalendarView project={project} />}</WithProject>
  )
}

function CalendarView({ project }: { readonly project: ProjectSummary }) {
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const update = (patch: Partial<Record<keyof ListTasksQuery, unknown>>) =>
    navigate({ search: (prev) => withTaskSearch(prev, patch) })

  return (
    <div className="space-y-4">
      <TaskFilterBar
        projectId={project.id}
        query={search}
        onChange={update}
        sorting={false}
        grouping={false}
      />
      <ProjectCalendar
        projectId={project.id}
        timezone={me.timezone}
        userId={me.userId}
        filter={search}
      />
    </div>
  )
}
