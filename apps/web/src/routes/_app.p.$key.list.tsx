import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { TaskFilterBar } from "../components/list/task-filter-bar.tsx"
import { parseTaskSearch, withTaskSearch } from "../components/list/task-search.ts"
import { VirtualTaskList } from "../components/list/task-rows.tsx"
import { WithProject } from "../components/list/with-project.tsx"
import { taskListQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/p/$key/list")({
  validateSearch: parseTaskSearch,
  component: ListPage,
})

function ListPage() {
  const { key } = Route.useParams()
  return (
    <WithProject projectKey={key}>{(project) => <ProjectList project={project} />}</WithProject>
  )
}

function ProjectList({ project }: { readonly project: ProjectSummary }) {
  const { t } = useLingui()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const tasks = useQuery(taskListQuery(project.id, search))

  const update = (patch: Partial<Record<keyof ListTasksQuery, unknown>>) =>
    navigate({ search: (prev) => withTaskSearch(prev, patch) })

  return (
    <div className="space-y-4">
      <TaskFilterBar projectId={project.id} query={search} onChange={update} sorting grouping />
      {tasks.isPending && <LoadingRows />}
      {tasks.isError && <ErrorMessage error={tasks.error} />}
      {tasks.isSuccess && (
        <VirtualTaskList
          groups={tasks.data.groups}
          showHeaders={search.groupBy !== undefined}
          label={t`Tasks in ${project.name}`}
        />
      )}
    </div>
  )
}
