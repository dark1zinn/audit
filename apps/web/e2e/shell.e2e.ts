import { expect, test } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}

/** The inner sidebar element; its width is the rail width when collapsed to icons. */
const sidebarWidth = async (page: import("@playwright/test").Page) => {
  const box = await page.locator('[data-sidebar="sidebar"]').first().boundingBox()
  if (box === null) throw new Error("sidebar is not laid out")
  return box.width
}

test("Ctrl+\\ collapses the sidebar to icons and the state survives a reload", async ({ page }) => {
  await page.goto("/")
  const docs = page.getByRole("link", { name: "Docs", exact: true }).first()
  await expect(docs).toBeVisible()

  await page.keyboard.press("Control+Backslash")
  await expect.poll(() => sidebarWidth(page)).toBeLessThanOrEqual(64)
  // The label is still the accessible name through the tooltip.
  await expect(docs).toBeVisible()

  await page.reload()
  await expect.poll(() => sidebarWidth(page)).toBeLessThanOrEqual(64)
  await expect(page.getByRole("link", { name: "Docs", exact: true }).first()).toBeVisible()
})

test("the breadcrumb on a project board names the project and Board", async ({ page }) => {
  const key = randomProjectKey()
  await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Shell project"),
  })
  await page.goto(`/p/${key}/board`)

  const crumbs = page.getByRole("navigation", { name: "breadcrumb", exact: true })
  await expect(crumbs).toContainText(key)
  await expect(crumbs).toContainText("Board")
})

test.describe("mobile shell", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the bottom tab bar's More drawer navigates to Calendar", async ({ page }) => {
    await page.goto("/")
    const primary = page.getByRole("navigation", { name: "Primary", exact: true })
    await expect(primary).toBeVisible()

    await primary.getByRole("button", { name: "More", exact: true }).click()
    const drawer = page.getByRole("dialog")
    await expect(drawer).toBeVisible()
    await drawer.getByText("Calendar", { exact: true }).click()

    await expect(page).toHaveURL(/\/calendar$/)
  })
})
