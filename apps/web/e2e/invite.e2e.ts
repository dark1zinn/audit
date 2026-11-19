import { expect, test } from "@playwright/test"
import { unique } from "./helpers.ts"

test("an admin invites a new member who joins through the link and signs in", async ({
  page,
  browser,
}) => {
  const email = `${unique("invitee").replaceAll(" ", ".")}@e2e.test`
  const password = "a fresh password 123"

  await page.goto("/admin/invites")
  await page.getByLabel("Email (optional)").fill(email)
  await page.getByRole("button", { name: "Create invite", exact: true }).click()
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue()
  expect(inviteUrl).toContain("/join/")

  const context = await browser.newContext()
  const guest = await context.newPage()
  await guest.goto(inviteUrl)
  await guest.getByLabel("Your name", { exact: true }).fill("New Member")
  await expect(guest.getByLabel("Email", { exact: true })).toHaveValue(email)
  await guest.getByLabel("Password", { exact: true }).fill(password)
  await guest.getByRole("button", { name: "Create account and join", exact: true }).click()

  await expect(guest).toHaveURL(/\/$/)
  await expect(guest.locator("main").first()).toBeVisible()
  await context.close()
})
