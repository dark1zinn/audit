import { expect, test, type Page } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface Board {
  readonly id: string
}
interface CreatedTask {
  readonly id: string
  readonly title: string
}
interface CreatedDoc {
  readonly id: string
  readonly title: string
}

/** A fresh project with its first board and one task in the first column (Backlog). */
const projectWithTask = async (page: Page, title: string) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Menu project"),
  })
  const boards = await api<ReadonlyArray<Board>>(
    page.request,
    "GET",
    `/api/projects/${project.id}/boards`,
  )
  const board = boards[0]
  if (board === undefined) throw new Error("project has no board")
  await api<CreatedTask>(page.request, "POST", `/api/boards/${board.id}/tasks`, { title })
  return { key }
}

test("right-clicking a task moves it through Move to, and the move persists", async ({ page }) => {
  const title = unique("Menu task")
  const { key } = await projectWithTask(page, title)
  await page.goto(`/p/${key}/board`)

  const backlog = page.getByRole("region", { name: "Backlog", exact: true })
  const inProgress = page.getByRole("region", { name: "In progress", exact: true })
  const card = backlog.getByRole("button", { name: title, exact: true })
  await expect(card).toBeVisible()

  await card.click({ button: "right" })
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await menu.getByRole("menuitem", { name: "Move to", exact: true }).click()
  await page.getByRole("menuitem", { name: "In progress", exact: true }).click()

  await expect(inProgress.getByRole("button", { name: title, exact: true })).toBeVisible()
  await expect(backlog.getByRole("button", { name: title, exact: true })).toHaveCount(0)

  await page.reload()
  await expect(
    page
      .getByRole("region", { name: "In progress", exact: true })
      .getByRole("button", { name: title, exact: true }),
  ).toBeVisible()
})

test("right-clicking empty board background shows no menu", async ({ page }) => {
  const { key } = await projectWithTask(page, unique("Background task"))
  await page.goto(`/p/${key}/board`)
  await expect(page.getByRole("region", { name: "Backlog", exact: true })).toBeVisible()

  // The bottom-right corner of the main area is board background, clear of the sidebar rail.
  const main = await page.locator("main").first().boundingBox()
  if (main === null) throw new Error("main is not laid out")
  await page.mouse.click(main.x + main.width - 8, main.y + main.height - 8, { button: "right" })
  await expect(page.getByRole("menu")).toHaveCount(0)
})

test("Shift+F10 opens the task menu from the keyboard and Escape returns focus to the card", async ({
  page,
}) => {
  const title = unique("Keyboard task")
  const { key } = await projectWithTask(page, title)
  await page.goto(`/p/${key}/board`)

  const card = page
    .getByRole("region", { name: "Backlog", exact: true })
    .getByRole("button", { name: title, exact: true })
  await card.focus()
  await page.keyboard.press("Shift+F10")

  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem").first()).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await expect(card).toBeFocused()
})

test("right-clicking a doc tree row deletes the doc after confirmation", async ({ page }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Tree project"),
  })
  const title = unique("Tree doc")
  await api<CreatedDoc>(page.request, "POST", "/api/docs", { parentId: project.id, title })
  await page.goto(`/p/${key}/docs`)

  const row = page.getByRole("treeitem", { name: title, exact: true })
  await expect(row).toBeVisible()
  await row.click({ button: "right" })
  await page.getByRole("menu").getByRole("menuitem", { name: "Delete", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click()

  await expect(row).toHaveCount(0)
})
