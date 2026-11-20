import { expect, test, type Page } from "@playwright/test"
import { BASE_URL, unique } from "./helpers.ts"

// Self sign-up asks for a name (optional) and an email only. The applicant then reaches the invite
// link (mailed, or copied by an administrator after approval) and chooses a password on the join page.
// The default e2e server has no SMTP, so requests wait for approval. The owner session comes from the
// project's storageState; visitors start with an empty one.

const PASSWORD = "a fresh password 123"
const ALLOWED_DOMAIN = "signup.e2e.test"

const visitorEmail = (label: string) =>
  `${unique(label).replaceAll(" ", ".").toLowerCase()}@${ALLOWED_DOMAIN}`

const requestSignup = async (page: Page, email: string) => {
  await page.goto("/signup")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Create account", exact: true }).click()
}

const joinWith = async (page: Page, link: string) => {
  await page.goto(link)
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/@/)
  await page.getByLabel("Your name", { exact: true }).fill("Visitor Applicant")
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Create account and join", exact: true }).click()
}

const trySignIn = async (page: Page, email: string) => {
  await page.goto("/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("sign-up by approval: request, reject, approve, copy link, join and sign in", async ({
  page,
  browser,
}) => {
  const applicant = visitorEmail("applicant")
  const rejected = visitorEmail("rejected")
  const outsider = `${unique("outsider").replaceAll(" ", ".").toLowerCase()}@elsewhere.e2e.test`

  // The owner allows one domain. The policy is restored to closed at the end.
  await page.goto("/admin/security")
  await page.getByText("Open to listed email domains", { exact: true }).click()
  await page.getByLabel("Allowed email domains").fill(ALLOWED_DOMAIN)
  await page.getByRole("button", { name: "Save", exact: true }).first().click()
  await expect(page.getByLabel("Allowed email domains")).toHaveValue(ALLOWED_DOMAIN)

  const visitor = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const guest = await visitor.newPage()

    await requestSignup(guest, applicant)
    await expect(guest.getByText("Request received", { exact: true })).toBeVisible()

    await requestSignup(guest, outsider)
    await expect(guest.getByText("Sign-up is closed", { exact: true })).toBeVisible()

    // Asking again with the same address gets the same answer; the newer request replaces the older.
    await requestSignup(guest, applicant)
    await expect(guest.getByText("Request received", { exact: true })).toBeVisible()

    await requestSignup(guest, rejected)
    await expect(guest.getByText("Request received", { exact: true })).toBeVisible()

    // Nothing is signed in before approval.
    await trySignIn(guest, applicant)
    await expect(guest.getByRole("alert")).toBeVisible()
    await expect(guest).toHaveURL(/\/login$/)

    await page.goto("/admin/members")
    await expect(page.getByText("Pending sign-ups", { exact: true })).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: applicant })).toHaveCount(1)
    await expect(page.getByRole("row").filter({ hasText: rejected })).toHaveCount(1)
    await expect(page.getByRole("row").filter({ hasText: outsider })).toHaveCount(0)

    await page
      .getByRole("row")
      .filter({ hasText: rejected })
      .getByRole("button", { name: "Reject", exact: true })
      .click()
    await expect(page.getByRole("row").filter({ hasText: rejected })).toHaveCount(0)

    await page
      .getByRole("row")
      .filter({ hasText: applicant })
      .getByRole("button", { name: "Approve", exact: true })
      .click()
    await expect(page.getByRole("row").filter({ hasText: applicant })).toHaveCount(0)

    // The approval shows the invite link; the admin passes it on to the applicant.
    const link = await page
      .getByText(/\/join\/\S+/)
      .first()
      .innerText()
    expect(link).toMatch(/\/join\/\S+/)

    await joinWith(guest, link)
    await expect(guest).toHaveURL(/\/$/)
    await expect(guest.locator("main").first()).toBeVisible()

    // The invite is single use: the same link no longer works.
    await guest.goto(link)
    await expect(guest.getByText("Invite unavailable", { exact: true })).toBeVisible()

    // The new password signs in on its own.
    await guest.context().clearCookies()
    await trySignIn(guest, applicant)
    await expect(guest).toHaveURL(/\/$/)

    // A rejected request never opens an account.
    const stranger = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    try {
      const rejectedGuest = await stranger.newPage()
      await trySignIn(rejectedGuest, rejected)
      await expect(rejectedGuest.getByRole("alert")).toBeVisible()
      await expect(rejectedGuest).toHaveURL(/\/login$/)
    } finally {
      await stranger.close()
    }
  } finally {
    await visitor.close()
    // Restore the closed policy only while the page is alive; after a timeout it is already gone and
    // a navigation here would replace the real failure with "target closed".
    if (!page.isClosed()) {
      await page.goto("/admin/security")
      await page.getByLabel("Closed: people join only by invitation").check()
      await page.getByRole("button", { name: "Save", exact: true }).first().click()
      await expect(page.getByLabel("Allowed email domains")).toBeDisabled()
    }
  }
})

type CapturedMail = { readonly to: string; readonly subject: string; readonly text: string }

// The mail server (`bun run e2e`, source runs) sends through the SMTP capture; the spec reads it.
const mailbox = async (to: string): Promise<CapturedMail[]> => {
  const response = await fetch(process.env.E2E_MAIL_CAPTURE_URL ?? "")
  const all = (await response.json()) as CapturedMail[]
  return all.filter((message) => message.to === to)
}

test("sign-up by email: mailed invite joins the workspace; a newer request replaces the older link", async ({
  browser,
}) => {
  test.skip(
    process.env.E2E_MAIL_BASE_URL === undefined,
    "needs the mail server that `bun run e2e` starts",
  )
  const mailUrl = process.env.E2E_MAIL_BASE_URL ?? ""
  const applicant = visitorEmail("mail applicant")

  // The owner of the mail server sets the password from the one-time link and allows the domain.
  const ownerContext = await browser.newContext({
    baseURL: mailUrl,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const owner = await ownerContext.newPage()
    await owner.goto(process.env.E2E_MAIL_OWNER_RESET_URL ?? "")
    await owner.getByLabel("New password", { exact: true }).fill("correct horse battery staple")
    await owner.getByRole("button", { name: "Change password", exact: true }).click()
    await expect(owner.getByText("Password changed", { exact: true })).toBeVisible()
    await owner.goto("/login")
    await owner.getByLabel("Email", { exact: true }).fill("owner@e2e.test")
    await owner.getByLabel("Password", { exact: true }).fill("correct horse battery staple")
    await owner.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(owner).toHaveURL(/\/$/)
    await owner.goto("/admin/security")
    await owner.getByText("Open to listed email domains", { exact: true }).click()
    await owner.getByLabel("Allowed email domains").fill(ALLOWED_DOMAIN)
    await owner.getByRole("button", { name: "Save", exact: true }).first().click()
    await expect(owner.getByLabel("Allowed email domains")).toHaveValue(ALLOWED_DOMAIN)
  } finally {
    await ownerContext.close()
  }

  const visitor = await browser.newContext({
    baseURL: mailUrl,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const guest = await visitor.newPage()
    await requestSignup(guest, applicant)
    await expect(guest.getByText("Check your email", { exact: true })).toBeVisible()

    // The mail carries the invite link bound to the requested address.
    await expect.poll(async () => (await mailbox(applicant)).length).toBe(1)
    const [first] = await mailbox(applicant)
    // Mail bodies are quoted-printable: a soft break is "=" at line end and must not join the token.
    const firstLink = first?.text.replace(/=\r?\n/g, "").match(/https?:\/\/\S+\/join\/[\w-]+/)?.[0]
    expect(firstLink).toBeDefined()

    // Asking again replaces the unused invite: the first link stops working.
    await requestSignup(guest, applicant)
    await expect(guest.getByText("Check your email", { exact: true })).toBeVisible()
    await expect.poll(async () => (await mailbox(applicant)).length).toBe(2)
    const [, second] = await mailbox(applicant)
    const secondLink = second?.text
      .replace(/=\r?\n/g, "")
      .match(/https?:\/\/\S+\/join\/[\w-]+/)?.[0]
    expect(secondLink).toBeDefined()

    await guest.goto(firstLink ?? "")
    await expect(guest.getByText("Invite unavailable", { exact: true })).toBeVisible()

    await joinWith(guest, secondLink ?? "")
    await expect(guest).toHaveURL(/\/$/)
    await expect(guest.locator("main").first()).toBeVisible()

    await guest.context().clearCookies()
    await trySignIn(guest, applicant)
    await expect(guest).toHaveURL(/\/$/)
  } finally {
    await visitor.close()
  }
})
