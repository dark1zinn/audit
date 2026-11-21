import { describe, expect, test } from "bun:test"
import type { DocId } from "@audit/domain/ids"
import {
  EMPTY_TABS,
  MAX_TABS,
  activateIn,
  closeTabIn,
  moveTabIn,
  neighbourAfterClose,
  openTabIn,
  parseTabs,
  setReadingIn,
} from "./doc-tabs.ts"

const id = (n: number) => `doc-${n}` as DocId
const ids = (state: { readonly tabs: ReadonlyArray<{ readonly id: string }> }) =>
  state.tabs.map((tab) => tab.id)

describe("doc tab reducers", () => {
  test("open appends a new tab and re-opening only activates it", () => {
    let state = openTabIn(EMPTY_TABS, { id: id(1), projectKey: null }, 1)
    state = openTabIn(state, { id: id(2), projectKey: "OPS" }, 2)
    state = openTabIn(state, { id: id(1), projectKey: null }, 3)
    expect(ids(state)).toEqual([id(1), id(2)])
    expect(state.tabs[0]?.lastActive).toBe(3)
    expect(state.tabs[1]?.projectKey).toBe("OPS")
  })

  test("the 13th tab evicts the least recently active tab", () => {
    let state = EMPTY_TABS
    for (let n = 1; n <= MAX_TABS; n++) {
      state = openTabIn(state, { id: id(n), projectKey: null }, n)
    }
    // Refresh tab 1 so tab 2 becomes the least recently active.
    state = activateIn(state, id(1), 100)
    state = openTabIn(state, { id: id(99), projectKey: null }, 101)
    expect(state.tabs).toHaveLength(MAX_TABS)
    expect(ids(state)).not.toContain(id(2))
    expect(ids(state)).toContain(id(1))
    expect(ids(state).at(-1)).toBe(id(99))
  })

  test("close removes only the named tab", () => {
    const state = closeTabIn(
      openTabIn(
        openTabIn(EMPTY_TABS, { id: id(1), projectKey: null }, 1),
        { id: id(2), projectKey: null },
        2,
      ),
      id(1),
    )
    expect(ids(state)).toEqual([id(2)])
  })

  test("closing the active tab picks the right neighbour, else the left, else null", () => {
    const tabs = [
      { id: id(1), projectKey: null, reading: false, lastActive: 1 },
      { id: id(2), projectKey: null, reading: false, lastActive: 2 },
      { id: id(3), projectKey: null, reading: false, lastActive: 3 },
    ]
    expect(neighbourAfterClose(tabs, id(2))).toBe(id(3))
    expect(neighbourAfterClose(tabs, id(3))).toBe(id(2))
    expect(neighbourAfterClose(tabs.slice(0, 1), id(1))).toBeNull()
  })

  test("move reorders and clamps the index", () => {
    let state = EMPTY_TABS
    for (let n = 1; n <= 3; n++) state = openTabIn(state, { id: id(n), projectKey: null }, n)
    expect(ids(moveTabIn(state, id(3), 0))).toEqual([id(3), id(1), id(2)])
    expect(ids(moveTabIn(state, id(1), 99))).toEqual([id(2), id(3), id(1)])
    expect(moveTabIn(state, id(42), 0)).toBe(state)
  })

  test("reading is stored per tab", () => {
    const state = setReadingIn(
      openTabIn(EMPTY_TABS, { id: id(1), projectKey: null }, 1),
      id(1),
      true,
    )
    expect(state.tabs[0]?.reading).toBe(true)
  })

  test("parseTabs drops malformed entries and tolerates bad JSON", () => {
    expect(parseTabs("not json")).toEqual(EMPTY_TABS)
    expect(parseTabs(null)).toEqual(EMPTY_TABS)
    const parsed = parseTabs(
      JSON.stringify({
        tabs: [
          { id: "a", projectKey: null, reading: false, lastActive: 1 },
          { id: 7, projectKey: null, reading: false, lastActive: 1 },
        ],
      }),
    )
    expect(ids(parsed)).toEqual(["a"])
  })
})
