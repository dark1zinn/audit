import { describe, expect, test } from "bun:test"
import {
  EVENT_FOREGROUND,
  TASKS_COLOR,
  calendarColorSets,
  tasksColorSets,
} from "./calendar-theme.ts"

describe("calendar colour sets", () => {
  test("user calendars keep their hue and use the theme foreground for text", () => {
    const sets = calendarColorSets("#ff0000")
    expect(sets.lightColors.main).toBe("#ff0000")
    expect(sets.darkColors.main).toBe("#ff0000")
    expect(sets.lightColors.onContainer).toBe(EVENT_FOREGROUND)
    expect(sets.darkColors.onContainer).toBe(EVENT_FOREGROUND)
  })

  test("dark containers are more opaque than light ones", () => {
    const sets = calendarColorSets("#ff0000")
    expect(sets.lightColors.container).not.toBe(sets.darkColors.container)
    expect(sets.lightColors.container.length).toBeGreaterThan(0)
    expect(sets.darkColors.container.endsWith("55")).toBe(true)
    expect(sets.lightColors.container.endsWith("33")).toBe(true)
  })

  test("the task calendar has no hardcoded colour", () => {
    const sets = tasksColorSets()
    expect(sets.lightColors.main).toBe(TASKS_COLOR)
    expect(sets.darkColors.main).toBe(TASKS_COLOR)
    expect(TASKS_COLOR).toBe("var(--muted-foreground)")
    expect(sets.lightColors.container).toContain(TASKS_COLOR)
    expect(sets.darkColors.container).toContain(TASKS_COLOR)
  })
})
