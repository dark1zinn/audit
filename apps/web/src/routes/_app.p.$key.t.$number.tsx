import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ProjectId } from "@audit/domain/ids"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { TaskPanel } from "../components/task-panel/task-panel.tsx"
import { taskByNumberQuery } from "../components/task-panel/queries.ts"
import { projectsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/p/$key/t/$number")({
  component: TaskPage,
})

function TaskPage() {
  const { t } = useLingui()
  const { key, number } = Route.useParams()
  const projects = useQuery(projectsQuery)
  const taskNumber = Number(number)

  if (!Number.isInteger(taskNumber) || taskNumber <= 0) {
    return <p className="text-sm text-muted-foreground">{t`Task not found.`}</p>
  }
  if (projects.isError) return <ErrorMessage error={projects.error} />
  if (projects.data === undefined) return <LoadingRows />

  const project = projects.data.find((candidate) => candidate.key === key)
  if (project === undefined) {
    return <p className="text-sm text-muted-foreground">{t`Project not found.`}</p>
  }

  return <TaskByNumber projectId={project.id} number={taskNumber} />
}

function TaskByNumber({
  projectId,
  number,
}: {
  readonly projectId: ProjectId
  readonly number: number
}) {
  const task = useQuery(taskByNumberQuery(projectId, number))

  if (task.isError) return <ErrorMessage error={task.error} />
  if (task.data === undefined) return <LoadingRows />
  return (
    <TaskPanel key={task.data.id} projectId={projectId} taskId={task.data.id} initial={task.data} />
  )
}
