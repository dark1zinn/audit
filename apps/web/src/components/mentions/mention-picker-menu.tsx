import { useLingui } from "@lingui/react/macro"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { toast } from "sonner"
import type { SearchQuery } from "@audit/domain/search/schema"
import { quickFindQuery, searchResultsQuery } from "../../lib/search.ts"
import {
  MentionPicker,
  type MentionItem,
  type MentionPickerExtension,
  type MentionTrigger,
  type MentionType,
} from "./mention-picker.ts"
import { usePopupPlacement } from "./popup-position.ts"

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

const TAB_TYPES: Record<Exclude<Tab, "all">, MentionType> = {
  people: "user",
  teams: "team",
  tasks: "task",
  docs: "doc",
  threads: "message",
  events: "event",
}

const TABS: ReadonlyArray<Tab> = ["all", "people", "teams", "tasks", "docs", "threads", "events"]

/** Search filter for one picker query; `types` is omitted for the "All" tab. */
const filterFor = (q: string, types: string | null): SearchQuery =>
  types === null ? { q, limit: 10 } : { q, types, limit: 10 }

/** One row of the menu: a searchable item, or the offer to create a doc from the query. */
export type PickerRow =
  | { readonly kind: "item"; readonly item: MentionItem }
  | { readonly kind: "create"; readonly title: string }

export interface MentionPickerOptions {
  /** The trigger extension. Defaults to the `@` picker; pass `WikilinkPicker` for `[[`. */
  readonly picker?: MentionPickerExtension
  /** Restricts results and tabs to these types. Default: every mentionable type. */
  readonly types?: ReadonlyArray<MentionType>
  /**
   * Adds a "Create doc" row for a non-empty query. The promise resolves to the new doc, which is
   * inserted as a mention in place of the typed trigger.
   */
  readonly onCreateDoc?: (title: string) => Promise<MentionItem>
}

export interface MentionPickerState {
  readonly extension: MentionPickerExtension
  readonly trigger: MentionTrigger | null
  readonly tab: Tab
  /** The tabs the menu offers: "All" plus the types allowed by `types`. */
  readonly tabs: ReadonlyArray<Tab>
  readonly rows: ReadonlyArray<PickerRow>
  readonly active: number
  readonly loading: boolean
  readonly selectTab: (tab: Tab) => void
  readonly select: (row: PickerRow) => void
}

/** Owns one editor's picker: the extension, the open trigger, and the menu data. */
export function useMentionPicker(options: MentionPickerOptions = {}): MentionPickerState {
  const { t } = useLingui()
  const { picker = MentionPicker, types, onCreateDoc } = options
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)
  const [tab, setTab] = useState<Tab>("all")
  const [index, setIndex] = useState(0)
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false)
  // The newest trigger, read after an async create: the user may have kept typing meanwhile.
  const latest = useRef<MentionTrigger | null>(null)
  const onTrigger = useEffectEvent((next: MentionTrigger | null) => {
    latest.current = next
    setTrigger(next)
  })
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => keyHandler.current(event))
  const extension = picker.configure({ onTrigger, onKeyDown })

  const allowed = (type: MentionType) => types === undefined || types.includes(type)
  const tabs = TABS.filter((entry) => entry === "all" || allowed(TAB_TYPES[entry]))

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
    isMentionType(hit.type) && allowed(hit.type)
      ? [{ id: hit.entityId, type: hit.type, label: hit.title }]
      : [],
  )
  const canCreate = onCreateDoc !== undefined && query !== "" && (tab === "all" || tab === "docs")
  const rows: ReadonlyArray<PickerRow> = [
    ...items.map((item): PickerRow => ({ kind: "item", item })),
    ...(canCreate ? [{ kind: "create" as const, title: query }] : []),
  ]
  const active = Math.min(index, Math.max(rows.length - 1, 0))
  const loading = tabType === null ? recent.isPending : typed.isPending

  const selectTab = (next: Tab) => {
    setTab(next)
    setIndex(0)
  }

  const select = (row: PickerRow) => {
    if (row.kind === "item") {
      latest.current?.insert(row.item)
      return
    }
    if (onCreateDoc === undefined) return
    void onCreateDoc(row.title).then(
      (item) => latest.current?.insert(item),
      () => toast.error(t`Could not create the doc`),
    )
  }

  const handleKey = (event: KeyboardEvent): boolean => {
    if (trigger === null || rows.length === 0) return false
    if (event.key === "ArrowDown") {
      setIndex((active + 1) % rows.length)
      return true
    }
    if (event.key === "ArrowUp") {
      setIndex((active - 1 + rows.length) % rows.length)
      return true
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const row = rows[active]
      if (row !== undefined) select(row)
      return true
    }
    return false
  }

  useEffect(() => {
    keyHandler.current = handleKey
  })

  return { extension, trigger, tab, tabs, rows, active, loading, selectTab, select }
}

/**
 * Picker menu with type tabs. "All" lists recent items when the query is empty; a type tab asks the
 * search index for that type, so people, teams, tasks, docs, threads, and events are all reachable.
 */
export function MentionPickerMenu({ picker }: { readonly picker: MentionPickerState }) {
  const { t } = useLingui()
  const { trigger, tab, tabs, rows, active, loading, selectTab, select } = picker
  const { ref, placement } = usePopupPlacement(trigger?.rect ?? null, rows.length)

  if (trigger === null) return null

  const labels: Record<Tab, string> = {
    all: t`All`,
    people: t`People`,
    teams: t`Teams`,
    tasks: t`Tasks`,
    docs: t`Docs`,
    threads: t`Threads`,
    events: t`Events`,
  }
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
      ref={ref}
      className="fixed z-50 flex w-80 flex-col overflow-hidden rounded-md border bg-popover text-sm shadow-md"
      style={
        placement === null
          ? undefined
          : { top: placement.top, left: placement.left, maxHeight: placement.maxHeight }
      }
    >
      <div
        role="tablist"
        aria-label={t`Mention type`}
        className="flex flex-wrap gap-1 border-b p-1"
      >
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rounded px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? "bg-accent font-medium" : "text-muted-foreground"}`}
            onMouseDown={(event) => {
              event.preventDefault()
              selectTab(id)
            }}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <ul aria-label={t`Mention`} className="min-h-0 max-h-64 flex-1 overflow-y-auto p-1">
        {rows.map((row, position) => {
          const key = row.kind === "item" ? `${row.item.type}:${row.item.id}` : "create"
          const current = position === active
          return (
            <li key={key}>
              <button
                type="button"
                aria-current={current}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-start focus-visible:ring-2 focus-visible:ring-ring ${current ? "bg-accent" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  select(row)
                }}
              >
                {row.kind === "item" ? (
                  <>
                    <span className="truncate">{row.item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {typeLabel[row.item.type]}
                    </span>
                  </>
                ) : (
                  <span className="truncate">{t`Create doc “${row.title}”`}</span>
                )}
              </button>
            </li>
          )
        })}
        {rows.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground">
            {loading ? t`Searching…` : t`No matches`}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
