import { expect, test } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}

test("a card dragged to another column stays there after reload", async ({ page }) => {
  const key = randomProjectKey()
  await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Board project"),
  })
  await page.goto(`/p/${key}/board`)

  const title = unique("Drag me")
  const todo = page.getByRole("region", { name: "To do", exact: true })
  const inProgress = page.getByRole("region", { name: "In progress", exact: true })

  await page.getByRole("textbox", { name: "Add a task to To do", exact: true }).fill(title)
  await page.getByRole("textbox", { name: "Add a task to To do", exact: true }).press("Enter")

  const card = todo.getByRole("button", { name: title, exact: true })
  // `has` locators resolve inside each candidate card, so anchor the title match at the page.
  const handle = todo
    .locator("[id^='board-card-']")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) })
    .getByRole("button", { name: /^Drag [A-Z]+-\d+$/ })
  await expect(card).toBeVisible()

  // Pointer drag: dnd-kit's pointer sensor needs movement past its activation distance.
  const from = await handle.boundingBox()
  const to = await inProgress.boundingBox()
  if (from === null || to === null) throw new Error("board columns are not laid out")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 25 })
  await page.mouse.up()

  await expect(inProgress.getByRole("button", { name: title, exact: true })).toBeVisible()
  await expect(todo.getByRole("button", { name: title, exact: true })).toHaveCount(0)

  await page.reload()
  await expect(
    page.getByRole("region", { name: "In progress", exact: true }).getByRole("button", {
      name: title,
      exact: true,
    }),
  ).toBeVisible()
})
