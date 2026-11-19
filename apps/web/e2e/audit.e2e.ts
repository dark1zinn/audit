import { expect, test } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}

test("the audit log lists an entry from an earlier action", async ({ page }) => {
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key: randomProjectKey(),
    name: unique("Audited project"),
  })

  await page.goto("/admin/audit")
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible()
  // The entity column prints the id of the changed record; the project created above is one.
  await expect(page.getByRole("table")).toContainText(project.id, { timeout: 15_000 })
})
