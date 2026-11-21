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
  await page.getByText(title).first().click()

  await expect(page.getByRole("heading", { name: "Edit event", exact: true })).toBeVisible()
  const renamed = `${title} (moved)`
  const titleField = page.getByLabel("Title", { exact: true })
  await titleField.fill(renamed)
  await page.getByRole("button", { name: "Save", exact: true }).click()

  await expect(
    page.getByRole("heading", { name: "Edit recurring event", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "All occurrences" }).click()

  await expect(page.getByText(renamed).first()).toBeVisible()
})

test("the calendar follows the dark theme from the account menu", async ({ page }) => {
  await page.goto("/")
  await page
    .getByRole("button", { name: /Olivia Owner/ })
    .first()
    .click()
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)

  await page.goto("/calendar")
  const wrapper = page.locator(".sx__calendar-wrapper").first()
  await expect(wrapper).toBeVisible()

  // The wrapper itself is transparent: the first painted element inside it carries the surface.
  const { painted, tokenBackground } = await wrapper.evaluate((element) => {
    const transparent = new Set(["rgba(0, 0, 0, 0)", "transparent"])
    const surface = [element, ...element.querySelectorAll("*")].find(
      (candidate) => !transparent.has(getComputedStyle(candidate).backgroundColor),
    )
    const probe = document.createElement("div")
    probe.style.backgroundColor = "var(--background)"
    document.body.append(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    return {
      painted: surface === undefined ? "" : getComputedStyle(surface).backgroundColor,
      tokenBackground: resolved,
    }
  })
  expect(painted).toBe(tokenBackground)
  expect(painted).not.toBe("rgb(255, 255, 255)")
})

test("an event link opens the event dialog on the calendar", async ({ page }) => {
  const listed = await api<CalendarList | ReadonlyArray<CalendarSummary>>(
    page.request,
    "GET",
    "/api/calendars",
  )
  const calendars = Array.isArray(listed) ? listed : ((listed as CalendarList).calendars ?? [])
  const calendar = calendars[0]
  if (calendar === undefined) throw new Error("no calendar for the owner")

  const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
  const event = await api<{ readonly eventId: string }>(
    page.request,
    "POST",
    `/api/calendars/${calendar.id}/events`,
    {
      calendarId: calendar.id,
      title: unique("Linked event"),
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      allDay: false,
      timezone: "UTC",
      rrule: null,
      location: "",
      description: null,
      attendees: [],
      reminders: [],
    },
  )

  await page.goto(`/calendar?event=${event.eventId}`)
  await expect(page.getByRole("heading", { name: "Edit event", exact: true })).toBeVisible()
})
