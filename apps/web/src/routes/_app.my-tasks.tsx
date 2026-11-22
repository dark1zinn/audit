import { useLingui } from "@lingui/react/macro"
import { t as tMacro } from "@lingui/core/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import { ErrorMessage, LoadingRows, PageBody, PageHeader } from "../components/feedback.tsx"
import { VirtualTaskList } from "../components/list/task-rows.tsx"
import type { TaskCard, TaskGroup } from "@audit/domain/tasks/schema"
import { myTasksQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/my-tasks")({
  staticData: { crumb: () => ({ label: tMacro`My tasks` }) },
  component: MyTasksPage,
})

function MyTasksPage() {
  const { t } = useLingui()
  const mine = useQuery(myTasksQuery)
  const groups = useMemo(() => groupByProject(mine.data ?? []), [mine.data])

  return (
    <PageBody width="wide">
      <PageHeader title={t`My tasks`} />
      <div className="space-y-4">
        {mine.isPending && <LoadingRows />}
        {mine.isError && <ErrorMessage error={mine.error} />}
        {mine.isSuccess && <VirtualTaskList groups={groups} showHeaders label={t`My tasks`} />}
      </div>
    </PageBody>
  )
}

/** Groups tasks by project key, keeping the server's sort order inside each group. */
function groupByProject(tasks: ReadonlyArray<TaskCard>): TaskGroup[] {
  const byProject = new Map<string, TaskCard[]>()
  for (const task of tasks) {
    const bucket = byProject.get(task.projectKey)
    if (bucket === undefined) byProject.set(task.projectKey, [task])
    else bucket.push(task)
  }
  return [...byProject].map(([projectKey, groupTasks]) => ({
    key: projectKey,
    label: projectKey,
    tasks: groupTasks,
  }))
}
