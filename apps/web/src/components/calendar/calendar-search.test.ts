import { describe, expect, test } from "bun:test"
import { parseCalendarSearch } from "./calendar-search.ts"

describe("parseCalendarSearch", () => {
  test("accepts an event id", () => {
    expect(parseCalendarSearch({ event: "evt_123" })).toEqual({ event: "evt_123" })
  })

  test("keeps the existing new-event param", () => {
    expect(parseCalendarSearch({ new: "1700000000" })).toEqual({ new: "1700000000" })
  })

  test("accepts a well-formed date and drops anything else", () => {
    expect(parseCalendarSearch({ date: "2026-06-10" })).toEqual({ date: "2026-06-10" })
    expect(parseCalendarSearch({ date: "10/06/2026" })).toEqual({})
    expect(parseCalendarSearch({ date: 20260610 })).toEqual({})
  })

  test("drops empty, non-string and unknown values", () => {
    expect(parseCalendarSearch({ event: "" })).toEqual({})
    expect(parseCalendarSearch({ event: 42 })).toEqual({})
    expect(parseCalendarSearch({ event: ["a", "b"] })).toEqual({})
    expect(parseCalendarSearch({ other: "x" })).toEqual({})
  })
})
