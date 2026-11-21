import { useSyncExternalStore } from "react"
import type { DocId } from "@audit/domain/ids"

export const MAX_TABS = 12
const STORAGE_KEY = "audit.docTabs"

export interface DocTab {
  readonly id: DocId
  readonly projectKey: string | null
  /** Reading mode is per tab; writers start in editing, read-only users are always in reading. */
  readonly reading: boolean
  /** Monotonic activation stamp; the smallest value is evicted when the cap is reached. */
  readonly lastActive: number
}

export interface DocTabsState {
  readonly tabs: ReadonlyArray<DocTab>
}

export const EMPTY_TABS: DocTabsState = { tabs: [] }

const replace = (state: DocTabsState, tabs: ReadonlyArray<DocTab>): DocTabsState => ({ tabs })

/** Opens a tab, or activates it when it is already open. Evicts the least recently active tab at the cap. */
export const openTabIn = (
  state: DocTabsState,
  tab: { readonly id: DocId; readonly projectKey: string | null; readonly reading?: boolean },
  now: number,
): DocTabsState => {
  const existing = state.tabs.find((candidate) => candidate.id === tab.id)
  if (existing !== undefined) {
    return replace(
      state,
      state.tabs.map((candidate) =>
        candidate.id === tab.id ? { ...candidate, lastActive: now } : candidate,
      ),
    )
  }
  const kept =
    state.tabs.length >= MAX_TABS
      ? state.tabs.filter((candidate) => candidate.id !== leastRecent(state.tabs)?.id)
      : state.tabs
  return replace(state, [
    ...kept,
    { id: tab.id, projectKey: tab.projectKey, reading: tab.reading ?? false, lastActive: now },
  ])
}

const leastRecent = (tabs: ReadonlyArray<DocTab>): DocTab | undefined =>
  tabs.reduce<DocTab | undefined>(
    (min, tab) => (min === undefined || tab.lastActive < min.lastActive ? tab : min),
    undefined,
  )

export const closeTabIn = (state: DocTabsState, id: DocId): DocTabsState =>
  replace(
    state,
    state.tabs.filter((tab) => tab.id !== id),
  )

/** Moves a tab to `toIndex`, clamped to the bounds of the list. */
export const moveTabIn = (state: DocTabsState, id: DocId, toIndex: number): DocTabsState => {
  const from = state.tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return state
  const next = [...state.tabs]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return state
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved)
  return replace(state, next)
}

export const activateIn = (state: DocTabsState, id: DocId, now: number): DocTabsState =>
  replace(
    state,
    state.tabs.map((tab) => (tab.id === id ? { ...tab, lastActive: now } : tab)),
  )

export const setReadingIn = (state: DocTabsState, id: DocId, reading: boolean): DocTabsState =>
  replace(
    state,
    state.tabs.map((tab) => (tab.id === id ? { ...tab, reading } : tab)),
  )

/** Where focus goes after closing `id`: the right neighbour, else the left, else `null` (the index). */
export const neighbourAfterClose = (tabs: ReadonlyArray<DocTab>, id: DocId): DocId | null => {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return null
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null
}

const isTab = (value: unknown): value is DocTab => {
  if (typeof value !== "object" || value === null) return false
  const tab = value as Record<string, unknown>
  return (
    typeof tab.id === "string" &&
    (typeof tab.projectKey === "string" || tab.projectKey === null) &&
    typeof tab.reading === "boolean" &&
    typeof tab.lastActive === "number"
  )
}

/** Parses the stored value; anything malformed becomes an empty tab list. */
export const parseTabs = (raw: string | null): DocTabsState => {
  if (raw === null) return EMPTY_TABS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return EMPTY_TABS
    const tabs = (parsed as { tabs?: unknown }).tabs
    if (!Array.isArray(tabs)) return EMPTY_TABS
    return {
      tabs: tabs
        .filter(isTab)
        .map((tab) => ({ ...tab, id: tab.id as DocId }))
        .slice(0, MAX_TABS),
    }
  } catch {
    return EMPTY_TABS
  }
}

const readStored = (): DocTabsState =>
  typeof localStorage === "undefined" ? EMPTY_TABS : parseTabs(localStorage.getItem(STORAGE_KEY))

let state: DocTabsState | null = null
const listeners = new Set<() => void>()
let clock = 0

const current = (): DocTabsState => {
  state ??= readStored()
  return state
}

const commit = (next: DocTabsState) => {
  state = next
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  for (const listener of listeners) listener()
}

const stamp = () => {
  clock = Math.max(clock + 1, Date.now())
  return clock
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const openTab = (tab: {
  readonly id: DocId
  readonly projectKey: string | null
  readonly reading?: boolean
}) => commit(openTabIn(current(), tab, stamp()))

export const closeTab = (id: DocId) => commit(closeTabIn(current(), id))

export const moveTab = (id: DocId, toIndex: number) => commit(moveTabIn(current(), id, toIndex))

export const activateTab = (id: DocId) => commit(activateIn(current(), id, stamp()))

export const setTabReading = (id: DocId, reading: boolean) =>
  commit(setReadingIn(current(), id, reading))

/** The open tabs, in tab order. Re-renders on every change. */
export const useDocTabs = (): DocTabsState =>
  useSyncExternalStore(subscribe, current, () => EMPTY_TABS)
