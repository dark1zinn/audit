import { expect, test } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface CalendarSummary {
  readonly id: string
  readonly projectId?: string | null
}
interface CalendarList {
  readonly calendars?: ReadonlyArray<CalendarSummary>
}

test("editing a recurring event for all occurrences shows the new title", async ({ page }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Calendar project"),
  })

  // The project's default calendar is created with the project.
  const listed = await api<CalendarList | ReadonlyArray<CalendarSummary>>(
    page.request,
    "GET",
    "/api/calendars",
  )
  const calendars = Array.isArray(listed) ? listed : ((listed as CalendarList).calendars ?? [])
  const calendar = calendars.find((c) => c.projectId === project.id)
  if (calendar === undefined) throw new Error("project calendar was not created")

  // Start at the top of the current hour so the first occurrence sits in the visible week.
  const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const title = unique("Weekly sync")
  await api(page.request, "POST", `/api/calendars/${calendar.id}/events`, {
    calendarId: calendar.id,
    title,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    timezone: "UTC",
    rrule: "FREQ=WEEKLY",
    location: "",
    description: null,
    attendees: [],
    reminders: [],
  })

  await page.goto(`/p/${key}/calendar`)
  await page.getByText(title, { exact: true }).first().click()

  await expect(page.getByRole("heading", { name: "Edit event", exact: true })).toBeVisible()
  const renamed = `${title} (moved)`
  const titleField = page.getByLabel("Title", { exact: true })
  await titleField.fill(renamed)
  await page.getByRole("button", { name: "Save", exact: true }).click()

  await expect(
    page.getByRole("heading", { name: "Edit recurring event", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "All occurrences" }).click()

  await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
})
