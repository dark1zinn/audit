import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { GitBranch } from "lucide-react"
import type { ProjectId, TaskId } from "@audit/domain/ids"
import type { Relation, TaskDetail } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { callApi } from "../../lib/api.ts"
import { EmptyState, ErrorMessage } from "../feedback.tsx"
import { taskListQuery } from "../../lib/queries.ts"
import { invalidateTask } from "./queries.ts"

type Kind = Relation["kind"]

interface RelationsProps {
  readonly task: TaskDetail
  readonly projectId: ProjectId
  readonly canEdit: boolean
}

export function Relations({ task, projectId, canEdit }: RelationsProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<Kind>("relates")
  const [search, setSearch] = useState("")
  const results = useQuery({
    ...taskListQuery(projectId, { text: search.trim() }),
    enabled: search.trim().length > 0,
  })

  const link = useMutation({
    mutationFn: (input: { readonly targetId: TaskId; readonly kind: Kind }) =>
      callApi((api) => api.tasks.link({ params: { taskId: task.id }, payload: input })),
    onSuccess: () => {
      setSearch("")
      return invalidateTask(queryClient, task.id)
    },
  })

  const unlink = useMutation({
    mutationFn: (relation: Relation) => {
      // Incoming relations are owned by the source task: unlink from its side.
      const source = relation.direction === "outgoing" ? task.id : (relation.targetId as TaskId)
      const target = relation.direction === "outgoing" ? (relation.targetId as TaskId) : task.id
      return callApi((api) =>
        api.tasks.unlink({
          params: { taskId: source },
          payload: { targetId: target, kind: relation.kind },
        }),
      )
    },
    onSuccess: () => invalidateTask(queryClient, task.id),
  })

  const candidates = (results.data?.groups ?? [])
    .flatMap((group) => group.tasks)
    .filter((candidate) => candidate.id !== task.id)

  return (
    <section aria-labelledby="task-relations-heading" className="space-y-3">
      <h2 id="task-relations-heading" className="text-base font-semibold">
        {t`Relations`}
      </h2>
      {task.relations.length === 0 && (
        <EmptyState size="sm" icon={GitBranch} title={t`No relations yet.`} />
      )}
      {task.relations.length > 0 && (
        <ul className="divide-y rounded-md border">
          {task.relations.map((relation) => (
            <li
              key={`${relation.kind}-${relation.direction}-${relation.targetId}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <span className="mr-2 text-muted-foreground">
                  {relationLabel(relation.kind, relation.direction, t)}
                </span>
                {relation.restricted || relation.title === null ? (
                  <span className="italic text-muted-foreground">{t`Restricted item`}</span>
                ) : (
                  <span>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {relation.key}
                    </span>
                    {relation.title}
                  </span>
                )}
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(relation)}
                >
                  {t`Remove relation`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="relation-kind">{t`Relation type`}</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
                <SelectTrigger id="relation-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relates">{t`Relates to`}</SelectItem>
                  <SelectItem value="blocks">{t`Blocks`}</SelectItem>
                  <SelectItem value="duplicates">{t`Duplicates`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relation-search">{t`Search tasks to link`}</Label>
              <Input
                id="relation-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          {results.isError && <ErrorMessage error={results.error} />}
          {candidates.length > 0 && (
            <ul className="divide-y rounded-md border">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {candidate.key}
                    </span>
                    {candidate.title}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={link.isPending}
                    onClick={() => link.mutate({ targetId: candidate.id, kind })}
                  >
                    {t`Link task`}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {link.error !== null && <ErrorMessage error={link.error} />}
          {unlink.error !== null && <ErrorMessage error={unlink.error} />}
        </div>
      )}
    </section>
  )
}

const relationLabel = (
  kind: Kind,
  direction: Relation["direction"],
  t: (strings: TemplateStringsArray) => string,
): string => {
  if (kind === "relates") return t`Relates to`
  if (kind === "blocks") return direction === "outgoing" ? t`Blocks` : t`Blocked by`
  return direction === "outgoing" ? t`Duplicates` : t`Duplicated by`
}
