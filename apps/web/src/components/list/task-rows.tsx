import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Link } from "@tanstack/react-router"
import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import type { TaskCard, TaskGroup } from "@audit/domain/tasks/schema"
import { useTaskText } from "./task-labels.ts"
import { taskHref } from "../../lib/entity-links.ts"

const HEADER_HEIGHT = 40
const ROW_HEIGHT = 56

/** The task number is the numeric suffix of its key (`OPS-42` -> `42`). */
export function taskNumber(key: string): string {
  return key.slice(key.lastIndexOf("-") + 1)
}

type Row =
  | { readonly kind: "header"; readonly id: string; readonly label: string; readonly count: number }
  | { readonly kind: "task"; readonly id: string; readonly task: TaskCard }

function buildRows(groups: ReadonlyArray<TaskGroup>, showHeaders: boolean): Row[] {
  return groups.flatMap((group) => {
    const tasks: Row[] = group.tasks.map((task): Row => ({ kind: "task", id: task.id, task }))
    if (!showHeaders) return tasks
    const header: Row = {
      kind: "header",
      id: `group:${group.key}`,
      label: group.label,
      count: group.tasks.length,
    }
    return [header, ...tasks]
  })
}

/**
 * Keyboard-navigable, virtualized task list. Task rows are links to the task panel; ArrowUp/Down
 * move between tasks, Home/End jump to the first or last one, Enter opens (native link behaviour).
 */
export function VirtualTaskList({
  groups,
  showHeaders,
  label,
}: {
  readonly groups: ReadonlyArray<TaskGroup>
  readonly showHeaders: boolean
  readonly label: string
}) {
  "use no memo"
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => buildRows(groups, showHeaders), [groups, showHeaders])
  const taskIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.kind === "task" ? [index] : [])),
    [rows],
  )
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const tabbableIndex = focusedIndex ?? taskIndexes[0]

  // TanStack Virtual returns memo-unsafe functions; this component opts out of React Compiler memoization.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  const focusRow = (index: number, attempt = 0) => {
    const link = scrollRef.current?.querySelector<HTMLAnchorElement>(
      `[data-row-index="${index}"] a`,
    )
    if (link) {
      link.focus()
    } else if (attempt < 10) {
      requestAnimationFrame(() => focusRow(index, attempt + 1))
    }
  }

  const moveTo = (index: number) => {
    setFocusedIndex(index)
    virtualizer.scrollToIndex(index, { align: "auto" })
    focusRow(index)
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const position = taskIndexes.indexOf(index)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveTo(taskIndexes[position + 1] ?? index)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveTo(taskIndexes[position - 1] ?? index)
    } else if (event.key === "Home") {
      event.preventDefault()
      moveTo(taskIndexes[0] ?? index)
    } else if (event.key === "End") {
      event.preventDefault()
      moveTo(taskIndexes.at(-1) ?? index)
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        <Trans>No tasks match these filters.</Trans>
      </p>
    )
  }

  return (
    <div ref={scrollRef} className="h-[calc(100svh-16rem)] overflow-auto rounded-lg border">
      <ul
        aria-label={label}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          const style = {
            transform: `translateY(${item.start}px)`,
            height: item.size,
          }
          if (row.kind === "header") {
            return (
              <li
                key={item.key}
                data-row-index={item.index}
                style={style}
                className="absolute top-0 left-0 flex w-full items-end px-3 pb-1"
              >
                <h2 className="text-sm font-semibold">
                  {row.label}{" "}
                  <span className="tabular-nums text-muted-foreground">{row.count}</span>
                </h2>
              </li>
            )
          }
          return (
            <li
              key={item.key}
              data-row-index={item.index}
              style={style}
              className="absolute top-0 left-0 w-full"
            >
              <TaskRow
                task={row.task}
                tabIndex={item.index === tabbableIndex ? 0 : -1}
                onFocus={() => setFocusedIndex(item.index)}
                onKeyDown={(event) => onRowKeyDown(event, item.index)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TaskRow({
  task,
  tabIndex,
  onFocus,
  onKeyDown,
}: {
  readonly task: TaskCard
  readonly tabIndex: number
  readonly onFocus: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void
}) {
  const { i18n } = useLingui()
  const { priorities, categories } = useTaskText()
  const [now] = useState(() => Date.now())
  const done = task.columnCategory === "done" || task.columnCategory === "canceled"
  const overdue = task.dueAt !== null && !done && task.dueAt.getTime() < now
  const dateFormat = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" })

  return (
    <Link
      to={taskHref(task.projectKey, taskNumber(task.key))}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="flex h-full items-center gap-3 border-b px-3 text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
    >
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
      {task.priority !== "none" && <Badge variant="outline">{priorities[task.priority]}</Badge>}
      <Badge variant="secondary">{categories[task.columnCategory]}</Badge>
      {task.subtaskCount > 0 && (
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
          <Trans>
            {task.subtasksDone}/{task.subtaskCount} subtasks
          </Trans>
        </span>
      )}
      {task.assignees.length > 0 && (
        <span className="hidden text-xs text-muted-foreground md:inline">
          <Plural value={task.assignees.length} one="# assignee" other="# assignees" />
        </span>
      )}
      {task.dueAt !== null && (
        <time
          dateTime={task.dueAt.toISOString()}
          className={`shrink-0 text-xs tabular-nums${overdue ? " font-medium text-destructive" : ""}`}
        >
          {dateFormat.format(task.dueAt)}
        </time>
      )}
    </Link>
  )
}
