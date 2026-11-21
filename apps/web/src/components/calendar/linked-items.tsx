import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link2, SearchX } from "lucide-react"
import type { EventOccurrence } from "@audit/domain/calendar/schema"
import type { ProjectId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { ToggleGroup, ToggleGroupItem } from "@audit/ui/components/ui/toggle-group.tsx"
import { callApi } from "../../lib/api.ts"
import { projectsQuery, taskListQuery } from "../../lib/queries.ts"
import { docTreeQuery } from "../docs/queries.ts"
import { EmptyState, ErrorMessage } from "../feedback.tsx"

type EventLink = EventOccurrence["links"][number]
type PickKind = "task" | "doc"

interface Candidate {
  readonly id: string
  readonly key: string | null
  readonly title: string
}

const MAX_CANDIDATES = 20

/**
 * Items linked to an event (tasks, docs, threads) with a search to add tasks and docs the viewer
 * can see. Lives outside the event `<form>` so Enter in the search box cannot submit the event.
 */
export function LinkedItems({
  eventId,
  links,
}: {
  readonly eventId: EventOccurrence["eventId"]
  readonly links: ReadonlyArray<EventLink>
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<PickKind>("task")
  const [search, setSearch] = useState("")
  const text = search.trim()
  const searching = text !== ""
  const projects = useQuery(projectsQuery)
  const projectIds: ReadonlyArray<ProjectId> = (projects.data ?? []).map((project) => project.id)

  const taskResults = useQueries({
    queries: projectIds.map((projectId) => ({
      ...taskListQuery(projectId, { text }),
      enabled: kind === "task" && searching,
    })),
  })
  const docResults = useQueries({
    queries: [null, ...projectIds].map((projectId) => ({
      ...docTreeQuery(projectId),
      enabled: kind === "doc" && searching,
    })),
  })

  const searchError = [...taskResults, ...docResults].find((result) => result.error)?.error ?? null

  const linkedIds = new Set(links.filter((link) => link.kind === kind).map((link) => link.id))
  const candidates = (() => {
    const found = new Map<string, Candidate>()
    if (kind === "task") {
      for (const result of taskResults) {
        for (const group of result.data?.groups ?? []) {
          for (const task of group.tasks) {
            found.set(task.id, { id: task.id, key: task.key, title: task.title })
          }
        }
      }
    } else {
      const needle = text.toLocaleLowerCase()
      for (const result of docResults) {
        for (const doc of result.data ?? []) {
          if (doc.title.toLocaleLowerCase().includes(needle)) {
            found.set(doc.id, { id: doc.id, key: null, title: doc.title })
          }
        }
      }
    }
    return [...found.values()].filter((candidate) => !linkedIds.has(candidate.id))
  })().slice(0, MAX_CANDIDATES)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["calendar-events"] })

  const link = useMutation({
    mutationFn: (variables: { readonly kind: PickKind; readonly targetId: string }) =>
      callApi((api) => api.calendar.linkEvent({ params: { eventId }, payload: variables })),
    onSuccess: async () => {
      setSearch("")
      await refresh()
    },
  })

  const unlink = useMutation({
    mutationFn: (item: EventLink) =>
      callApi((api) =>
        api.calendar.unlinkEvent({
          params: { eventId },
          payload: { kind: item.kind, targetId: item.id },
        }),
      ),
    onSuccess: refresh,
  })

  const kindLabel = (value: EventLink["kind"]) => {
    switch (value) {
      case "task":
        return t`Task`
      case "doc":
        return t`Doc`
      case "thread":
        return t`Thread`
    }
  }

  const mutationError = link.error ?? unlink.error

  return (
    <section aria-labelledby="event-links-heading" className="space-y-3">
      <h3 id="event-links-heading" className="text-sm font-medium">
        <Trans>Linked items</Trans>
      </h3>
      {links.length === 0 && <EmptyState size="sm" icon={Link2} title={t`No linked items yet.`} />}
      {links.length > 0 && (
        <ul className="divide-y rounded-md border">
          {links.map((item) => {
            const restricted = item.restricted || item.title === null
            const title = restricted ? t`Restricted item` : (item.title ?? "")
            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="mr-2 text-xs text-muted-foreground">{kindLabel(item.kind)}</span>
                  {restricted ? (
                    <span className="italic text-muted-foreground">{title}</span>
                  ) : (
                    title
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={unlink.isPending}
                  aria-label={t`Unlink ${title}`}
                  onClick={() => unlink.mutate(item)}
                >
                  <Trans>Unlink</Trans>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-3 rounded-md border p-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="space-y-2">
            <span id="event-link-kind-label" className="text-sm font-medium">
              <Trans>Item type</Trans>
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={kind}
              aria-labelledby="event-link-kind-label"
              onValueChange={(value) => {
                if (value === "task" || value === "doc") setKind(value)
              }}
            >
              <ToggleGroupItem value="task">
                <Trans>Tasks</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem value="doc">
                <Trans>Docs</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-link-search">
              <span>{kind === "task" ? t`Search tasks to link` : t`Search docs to link`}</span>
            </Label>
            <Input
              id="event-link-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
        </div>

        {searchError !== null && <ErrorMessage error={searchError} />}
        {searching && !searchError && candidates.length === 0 && (
          <EmptyState size="sm" icon={SearchX} title={t`No matching items.`} />
        )}
        {candidates.length > 0 && (
          <ul className="divide-y rounded-md border">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  {candidate.key !== null && (
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {candidate.key}
                    </span>
                  )}
                  {candidate.title}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={link.isPending}
                  aria-label={t`Link ${candidate.title}`}
                  onClick={() => link.mutate({ kind, targetId: candidate.id })}
                >
                  <Trans>Link</Trans>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {mutationError !== null && <ErrorMessage error={mutationError} />}
      </div>
    </section>
  )
}
