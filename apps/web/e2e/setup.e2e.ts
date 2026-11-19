import { expect, test } from "@playwright/test"
import { OWNER, OWNER_STATE, SETUP_TOKEN, WORKSPACE_NAME, signIn } from "./helpers.ts"

test("first-run setup creates the workspace and signs the owner in", async ({ page }) => {
  await page.goto(`/setup?token=${encodeURIComponent(SETUP_TOKEN)}`)
  await page.getByLabel("Workspace name", { exact: true }).fill(WORKSPACE_NAME)
  await page.getByLabel("Your name", { exact: true }).fill(OWNER.name)
  await page.getByLabel("Email", { exact: true }).fill(OWNER.email)
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password)
  await page.getByRole("button", { name: "Create workspace", exact: true }).click()

  await expect(page).toHaveURL(/\/$/)
  await page.context().storageState({ path: OWNER_STATE })
})

test("the owner can sign in again with email and password", async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, OWNER.email, OWNER.password)
  await expect(page.locator("main").first()).toBeVisible()
  await context.close()
})
