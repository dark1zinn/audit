import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { BoardId, ProjectId } from "@audit/domain/ids"
import type { TaskDetail } from "@audit/domain/tasks/schema"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { TaskPanel } from "../components/task-panel/task-panel.tsx"
import { taskByNumberQuery } from "../components/task-panel/queries.ts"
import { boardViewQuery, projectsQuery } from "../lib/queries.ts"

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

  return (
    <TaskByNumber projectId={project.id} boardId={project.defaultBoardId} number={taskNumber} />
  )
}

function TaskByNumber({
  projectId,
  boardId,
  number,
}: {
  readonly projectId: ProjectId
  readonly boardId: BoardId | null
  readonly number: number
}) {
  const task = useQuery(taskByNumberQuery(projectId, number))

  if (task.isError) return <ErrorMessage error={task.error} />
  if (task.data === undefined) return <LoadingRows />
  if (boardId === null) {
    return (
      <TaskPanel
        key={task.data.id}
        projectId={projectId}
        taskId={task.data.id}
        initial={task.data}
      />
    )
  }
  return <TaskWithColumns projectId={projectId} boardId={boardId} task={task.data} />
}

/** Loads the board's columns (same query as the board screen) so the header menu can offer "Move to". */
function TaskWithColumns({
  projectId,
  boardId,
  task,
}: {
  readonly projectId: ProjectId
  readonly boardId: BoardId
  readonly task: TaskDetail
}) {
  const board = useQuery(boardViewQuery(boardId, {}))
  return (
    <TaskPanel
      key={task.id}
      projectId={projectId}
      taskId={task.id}
      initial={task}
      columns={board.data?.columns}
    />
  )
}
