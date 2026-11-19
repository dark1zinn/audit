import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useMemo, useState } from "react"
import type { BoardId, ColumnId, TaskId } from "@audit/domain/ids"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import type { TaskCard as TaskCardModel } from "@audit/domain/tasks/schema"
import { Avatar, AvatarFallback } from "@audit/ui/components/ui/avatar.tsx"
import { BoardView } from "../components/board/board-view.tsx"
import { BulkBar } from "../components/board/bulk-bar.tsx"
import {
  cardDomId,
  lanesOf,
  patchQuery,
  taskNumber,
  validateBoardSearch,
  type FilterPatch,
} from "../components/board/board-model.ts"
import { useCreateTask, useMoveTask } from "../components/board/board-mutations.ts"
import { FiltersBar } from "../components/board/filters-bar.tsx"
import { useBoardShortcuts, useReducedMotion } from "../components/board/hooks.ts"
import { SavedFilters } from "../components/board/saved-filters.tsx"
import { initials } from "../components/board/task-card.tsx"
import { TaskQuickEdit, type QuickEditMode } from "../components/board/task-quick-edit.tsx"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { useMe } from "../components/use-me.ts"
import { boardViewQuery, labelsQuery, membersQuery, projectsQuery } from "../lib/queries.ts"
import { usePresence, useRealtimeScopes } from "../lib/realtime.ts"

export const Route = createFileRoute("/_app/p/$key/board")({
  validateSearch: validateBoardSearch,
  component: BoardPage,
})

function BoardPage() {
  const { t } = useLingui()
  const { key } = Route.useParams()
  const projects = useQuery(projectsQuery)

  if (projects.isPending) return <LoadingRows />
  if (projects.isError) return <ErrorMessage error={projects.error} />

  const project = projects.data.find((candidate) => candidate.key === key)
  if (project === undefined) return <p role="alert">{t`Project not found.`}</p>
  if (project.defaultBoardId === null) return <p role="alert">{t`This project has no board.`}</p>

  return <BoardScreen project={project} boardId={project.defaultBoardId} />
}

interface BoardScreenProps {
  readonly project: ProjectSummary
  readonly boardId: BoardId
}

function BoardScreen({ project, boardId }: BoardScreenProps) {
  const { t } = useLingui()
  const navigate = Route.useNavigate()
  const query = Route.useSearch()
  const me = useMe()
  const reduced = useReducedMotion()
  const scope = `project:${project.key}`

  useRealtimeScopes([scope])
  const viewers = usePresence(scope).filter((viewer) => viewer.userId !== me.userId)

  const view = useQuery(boardViewQuery(boardId, query))
  const labels = useQuery(labelsQuery(project.id))
  const members = useQuery(membersQuery)

  const move = useMoveTask(boardId)
  const create = useCreateTask(boardId)

  const [selected, setSelected] = useState<ReadonlyArray<TaskId>>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [quick, setQuick] = useState<{ mode: QuickEditMode; card: TaskCardModel } | null>(null)

  const labelMap = useMemo(
    () => new Map((labels.data ?? []).map((label) => [label.id, label] as const)),
    [labels.data],
  )
  const memberMap = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.userId, member] as const)),
    [members.data],
  )
  const visibleSelected = useMemo(() => {
    if (view.data === undefined) return selected
    const visible = new Set(
      view.data.columns.flatMap((column) => column.tasks.map((task) => task.id)),
    )
    return selected.filter((id) => visible.has(id))
  }, [selected, view.data])
  const selectedSet = useMemo(() => new Set<string>(visibleSelected), [visibleSelected])

  const patchSearch = useCallback(
    (patch: FilterPatch) => navigate({ search: (prev) => patchQuery(prev, patch), replace: true }),
    [navigate],
  )

  const openTask = useCallback(
    (card: TaskCardModel) =>
      navigate({
        to: "/p/$key/t/$number",
        params: { key: project.key, number: taskNumber(card.key) },
      }),
    [navigate, project.key],
  )

  const shortcuts = (() => {
    const board = view.data
    const focused = (): TaskCardModel | undefined =>
      board?.columns.flatMap((column) => column.tasks).find((task) => task.id === focusedId)
    const focusTask = (id: string) => document.getElementById(cardDomId(id))?.focus()
    const order = board === undefined ? [] : Object.values(lanesOf(board)).flat()
    const step = (delta: number) => {
      if (order.length === 0) return
      const index = focusedId === null ? -1 : order.indexOf(focusedId)
      const next = order[(index + delta + order.length) % order.length]
      if (next !== undefined) {
        setFocusedId(next)
        focusTask(next)
      }
    }
    const withCard = (mode: QuickEditMode) => () => {
      const card = focused()
      if (card !== undefined) setQuick({ mode, card })
    }
    return {
      c: () => {
        const columnId = focused()?.columnId ?? board?.columns[0]?.id
        if (columnId !== undefined) document.getElementById(`quick-add-${columnId}`)?.focus()
      },
      e: () => {
        const card = focused()
        if (card !== undefined) void openTask(card)
      },
      a: withCard("assign"),
      l: withCard("label"),
      m: withCard("move"),
      x: () => {
        const id = focused()?.id
        if (id !== undefined) {
          setSelected((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
      },
      j: () => step(1),
      k: () => step(-1),
    }
  })()

  useBoardShortcuts(shortcuts)

  if (view.isPending) return <LoadingRows />
  if (view.isError) return <ErrorMessage error={view.error} />

  const board = view.data
  const quickCard = quick?.card

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltersBar
          query={query}
          labels={labels.data ?? []}
          members={members.data ?? []}
          onPatch={patchSearch}
          onReset={() => navigate({ search: {}, replace: true })}
        />
        <ul aria-label={t`Also viewing`} className="flex -space-x-2">
          {viewers.map((viewer) => (
            <li key={viewer.userId} aria-label={t`${viewer.name} is viewing`}>
              <Avatar className="size-7 border-2">
                <AvatarFallback>{initials(viewer.name)}</AvatarFallback>
              </Avatar>
            </li>
          ))}
        </ul>
      </div>
      <SavedFilters
        projectId={project.id}
        query={query}
        onApply={(filter) => navigate({ search: filter, replace: true })}
      />
      {visibleSelected.length > 0 ? (
        <BulkBar
          boardId={boardId}
          taskIds={visibleSelected}
          columns={board.columns}
          labels={labels.data ?? []}
          members={members.data ?? []}
          onDone={() => setSelected([])}
        />
      ) : null}
      <BoardView
        view={board}
        labels={labelMap}
        members={memberMap}
        selected={selectedSet}
        reduced={reduced}
        onToggle={(taskId) => {
          const id = taskId as TaskId
          setSelected((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }}
        onOpen={(card) => void openTask(card)}
        onFocus={setFocusedId}
        onMove={(request) => move.mutate(request)}
        onQuickAdd={(columnId, title) => create.mutate({ title, columnId: columnId as ColumnId })}
      />
      {quick !== null && quickCard !== undefined ? (
        <TaskQuickEdit
          key={`${quickCard.id}-${quick.mode}`}
          boardId={boardId}
          mode={quick.mode}
          card={quickCard}
          view={board}
          labels={labels.data ?? []}
          members={members.data ?? []}
          onClose={() => setQuick(null)}
        />
      ) : null}
    </div>
  )
}
