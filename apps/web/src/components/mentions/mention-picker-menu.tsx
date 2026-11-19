import type { Extension } from "@tiptap/core"
import { useLingui } from "@lingui/react/macro"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { SearchQuery } from "@audit/domain/search/schema"
import { quickFindQuery, searchResultsQuery } from "../../lib/search.ts"
import {
  MentionPicker,
  type MentionItem,
  type MentionTrigger,
  type MentionType,
} from "./mention-picker.ts"

type Tab = "all" | "people" | "teams" | "tasks" | "docs" | "threads" | "events"

/** Entity types the search index returns that the mention node can carry. */
const MENTIONABLE: Record<MentionType, true> = {
  user: true,
  team: true,
  task: true,
  doc: true,
  message: true,
  channel: true,
  event: true,
}

const isMentionType = (type: string): type is MentionType => Object.hasOwn(MENTIONABLE, type)

const TAB_TYPES: Record<Exclude<Tab, "all">, string> = {
  people: "user",
  teams: "team",
  tasks: "task",
  docs: "doc",
  threads: "message",
  events: "event",
}

/** Search filter for one picker query; `types` is omitted for the "All" tab. */
const filterFor = (q: string, types: string | null): SearchQuery =>
  types === null ? { q, limit: 10 } : { q, types, limit: 10 }

export interface MentionPickerState {
  readonly extension: Extension
  readonly trigger: MentionTrigger | null
  readonly tab: Tab
  readonly items: ReadonlyArray<MentionItem>
  readonly active: number
  readonly loading: boolean
  readonly selectTab: (tab: Tab) => void
}

/** Owns one editor's `@` picker: the extension, the open trigger, and the menu data. */
export function useMentionPicker(): MentionPickerState {
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)
  const [tab, setTab] = useState<Tab>("all")
  const [index, setIndex] = useState(0)
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false)
  const onTrigger = useEffectEvent((next: MentionTrigger | null) => setTrigger(next))
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => keyHandler.current(event))
  const extension = MentionPicker.configure({ onTrigger, onKeyDown })

  const open = trigger !== null
  const query = trigger?.query.trim() ?? ""
  const tabType = tab === "all" ? null : TAB_TYPES[tab]
  const recent = useQuery({
    ...quickFindQuery(query),
    enabled: open && tabType === null,
    placeholderData: keepPreviousData,
  })
  const typed = useQuery({
    ...searchResultsQuery(filterFor(query, tabType)),
    enabled: open && tabType !== null,
    placeholderData: keepPreviousData,
  })
  const hits = tabType === null ? (recent.data ?? []) : (typed.data?.hits ?? [])
  const items: ReadonlyArray<MentionItem> = hits.flatMap((hit) =>
    isMentionType(hit.type) ? [{ id: hit.entityId, type: hit.type, label: hit.title }] : [],
  )
  const active = Math.min(index, Math.max(items.length - 1, 0))
  const loading = tabType === null ? recent.isPending : typed.isPending

  const selectTab = (next: Tab) => {
    setTab(next)
    setIndex(0)
  }

  const handleKey = (event: KeyboardEvent): boolean => {
    if (trigger === null || items.length === 0) return false
    if (event.key === "ArrowDown") {
      setIndex((active + 1) % items.length)
      return true
    }
    if (event.key === "ArrowUp") {
      setIndex((active - 1 + items.length) % items.length)
      return true
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const item = items[active]
      if (item !== undefined) trigger.insert(item)
      return true
    }
    return false
  }

  useEffect(() => {
    keyHandler.current = handleKey
  })

  return { extension, trigger, tab, items, active, loading, selectTab }
}

/**
 * `@` picker with type tabs. "All" lists recent items when the query is empty; a type tab asks the
 * search index for that type, so people, teams, tasks, docs, threads, and events are all reachable.
 */
export function MentionPickerMenu({ picker }: { readonly picker: MentionPickerState }) {
  const { t } = useLingui()
  const { trigger, tab, items, active, loading, selectTab } = picker

  if (trigger === null) return null

  const tabs: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
    { id: "all", label: t`All` },
    { id: "people", label: t`People` },
    { id: "teams", label: t`Teams` },
    { id: "tasks", label: t`Tasks` },
    { id: "docs", label: t`Docs` },
    { id: "threads", label: t`Threads` },
    { id: "events", label: t`Events` },
  ]
  const typeLabel: Record<MentionType, string> = {
    user: t`Person`,
    team: t`Team`,
    task: t`Task`,
    doc: t`Doc`,
    message: t`Thread`,
    channel: t`Channel`,
    event: t`Event`,
  }

  return (
    <div
      className="fixed z-50 w-80 rounded-md border bg-popover text-sm shadow-md"
      style={
        trigger.rect === null
          ? undefined
          : { top: trigger.rect.bottom + 4, left: trigger.rect.left }
      }
    >
      <div
        role="tablist"
        aria-label={t`Mention type`}
        className="flex flex-wrap gap-1 border-b p-1"
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`rounded px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-ring ${tab === entry.id ? "bg-accent font-medium" : "text-muted-foreground"}`}
            onMouseDown={(event) => {
              event.preventDefault()
              selectTab(entry.id)
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <ul aria-label={t`Mention`} className="max-h-64 overflow-y-auto p-1">
        {items.map((item, position) => (
          <li key={`${item.type}:${item.id}`}>
            <button
              type="button"
              aria-current={position === active}
              className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left ${position === active ? "bg-accent" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault()
                trigger.insert(item)
              }}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{typeLabel[item.type]}</span>
            </button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground">
            {loading ? t`Searching…` : t`No matches`}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
