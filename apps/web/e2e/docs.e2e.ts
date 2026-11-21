import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { OWNER_STATE, api, randomProjectKey, unique } from "./helpers.ts"

test.use({ storageState: OWNER_STATE })

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface CreatedDoc {
  readonly id: string
  readonly title: string
}

const MEMBER_PASSWORD = "a member password 123"

/** A fresh project with a unique key, created by the signed-in owner of `page`. */
const createProject = async (page: Page) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Docs project"),
  })
  return { key, id: project.id }
}

const createDoc = async (page: Page, parentId: string, title: string) =>
  api<CreatedDoc>(page.request, "POST", "/api/docs", { parentId, title })

/** Invites a member through the admin console and signs them in in a fresh browser context. */
const newMember = async (owner: Page, browser: Browser): Promise<BrowserContext> => {
  const email = `${unique("member").replaceAll(" ", ".")}@e2e.test`
  await owner.goto("/admin/invites")
  await owner.getByLabel("Email (optional)").fill(email)
  await owner.getByRole("button", { name: "Create invite", exact: true }).click()
  const inviteUrl = await owner.getByLabel("Invite link", { exact: true }).inputValue()
  const context = await browser.newContext()
  const guest = await context.newPage()
  await guest.goto(inviteUrl)
  await guest.getByLabel("Your name", { exact: true }).fill("Mona Member")
  await guest.getByLabel("Password", { exact: true }).fill(MEMBER_PASSWORD)
  await guest.getByRole("button", { name: "Create account and join", exact: true }).click()
  await expect(guest).toHaveURL(/\/$/)
  return context
}

/** Opens the doc header "Actions for …" menu and returns the menu locator. */
const openDocActions = async (page: Page, title: string) => {
  await page
    .getByRole("button", { name: `Actions for ${title}`, exact: true })
    .last()
    .click()
  return page.getByRole("menu")
}

test("two sessions editing the same doc see each other's text", async ({ page, browser }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Docs project"),
  })
  const doc = await api<CreatedDoc>(page.request, "POST", "/api/docs", {
    parentId: project.id,
    title: unique("Co-edit"),
  })
  const path = `/p/${key}/docs/${doc.id}`

  const first = await browser.newContext({ storageState: OWNER_STATE })
  const second = await browser.newContext({ storageState: OWNER_STATE })
  try {
    const a = await first.newPage()
    const b = await second.newPage()
    await a.goto(path)
    await b.goto(path)

    const editorA = a.locator(".ProseMirror").first()
    const editorB = b.locator(".ProseMirror").first()
    await expect(editorA).toBeVisible()
    await expect(editorB).toBeVisible()

    const fromA = unique("typed in A")
    await editorA.click()
    await a.keyboard.type(fromA)
    await expect(editorB).toContainText(fromA, { timeout: 20_000 })

    const fromB = unique("typed in B")
    await editorB.click()
    await b.keyboard.press("End")
    await b.keyboard.type(` ${fromB}`)
    await expect(editorA).toContainText(fromB, { timeout: 20_000 })
  } finally {
    await first.close()
    await second.close()
  }
})

test("a member deletes their own doc, but not one created by the owner", async ({
  page,
  browser,
}) => {
  const project = await createProject(page)
  const ownerDoc = await createDoc(page, project.id, unique("Owner doc"))
  const member = await newMember(page, browser)
  try {
    const memberPage = await member.newPage()
    const memberDoc = await createDoc(memberPage, project.id, unique("Member doc"))

    await memberPage.goto(`/p/${project.key}/docs/${memberDoc.id}`)
    const menu = await openDocActions(memberPage, memberDoc.title)
    await menu.getByRole("menuitem", { name: "Delete", exact: true }).click()
    await memberPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click()
    await expect(memberPage).not.toHaveURL(new RegExp(memberDoc.id))

    await memberPage.goto(`/p/${project.key}/docs/${ownerDoc.id}`)
    await openDocActions(memberPage, ownerDoc.title)
    await expect(memberPage.getByRole("menuitem", { name: /^Delete/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    await expect(
      memberPage.getByText("Only the creator or a manager can delete this doc"),
    ).toBeVisible()
  } finally {
    await member.close()
  }
})

test("an owner deletes a doc a member created inside a project", async ({ page, browser }) => {
  const project = await createProject(page)
  const member = await newMember(page, browser)
  let memberDocId = ""
  let memberDocTitle = ""
  try {
    const memberPage = await member.newPage()
    const memberDoc = await createDoc(memberPage, project.id, unique("Member's doc"))
    memberDocId = memberDoc.id
    memberDocTitle = memberDoc.title
  } finally {
    await member.close()
  }

  await page.goto(`/p/${project.key}/docs/${memberDocId}`)
  const menu = await openDocActions(page, memberDocTitle)
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(memberDocId))
})

test("typing [[ links another doc, and the chip navigates and offers Open", async ({ page }) => {
  const project = await createProject(page)
  const target = await createDoc(page, project.id, unique("Linked target"))
  const source = await createDoc(page, project.id, unique("Linking source"))

  await page.goto(`/p/${project.key}/docs/${source.id}`)
  const editor = page.locator(".ProseMirror").first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type("See [[Linked target")
  await page
    .locator('[aria-label="Mention"]')
    .getByText(target.title, { exact: false })
    .first()
    .click()

  const chip = editor.locator("a", { hasText: target.title }).first()
  await expect(chip).toBeVisible()

  await chip.click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await chip.click()
  await expect(page).toHaveURL(new RegExp(target.id))
})

test("a heading shows in the outline and clicking it scrolls to it", async ({ page }) => {
  const project = await createProject(page)
  const doc = await createDoc(page, project.id, unique("Outline doc"))
  const heading = unique("Section heading")

  await page.goto(`/p/${project.key}/docs/${doc.id}`)
  const editor = page.locator(".ProseMirror").first()
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type(`# ${heading}`)

  await expect(editor.getByRole("heading", { name: heading })).toBeVisible()
  const outline = page.getByRole("navigation", { name: "Outline", exact: true })
  const entry = outline.getByRole("button", { name: heading, exact: true })
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  await expect(editor.getByRole("heading", { name: heading })).toBeInViewport()
})

test("open to the side shows two editors, and close split leaves one", async ({ page }) => {
  const project = await createProject(page)
  const main = await createDoc(page, project.id, unique("Main pane"))
  const side = await createDoc(page, project.id, unique("Side pane"))

  await page.goto(`/p/${project.key}/docs/${main.id}`)
  await expect(page.locator(".ProseMirror").first()).toBeVisible()
  await page
    .getByTestId("docs-tree")
    .getByRole("button", { name: `Actions for ${side.title}`, exact: true })
    .click()
  await page.getByRole("menuitem", { name: /^Open to the side/ }).click()
  await expect(page.locator(".ProseMirror")).toHaveCount(2)

  await page.getByRole("button", { name: "Close split", exact: true }).click()
  await expect(page.locator(".ProseMirror")).toHaveCount(1)
})

test("Ctrl+E toggles the editor between editing and reading", async ({ page }) => {
  const project = await createProject(page)
  const doc = await createDoc(page, project.id, unique("Mode doc"))

  await page.goto(`/p/${project.key}/docs/${doc.id}`)
  const editor = page.locator(".ProseMirror").first()
  await expect(editor).toHaveAttribute("contenteditable", "true")
  await editor.click()

  await page.keyboard.press("Control+e")
  await expect(editor).toHaveAttribute("contenteditable", "false")

  await page.keyboard.press("Control+e")
  await expect(editor).toHaveAttribute("contenteditable", "true")
})

test("Ctrl+. hides the sidebar and tree, and Escape restores them", async ({ page }) => {
  const project = await createProject(page)
  const doc = await createDoc(page, project.id, unique("Focus doc"))

  await page.goto(`/p/${project.key}/docs/${doc.id}`)
  const tree = page.getByRole("tree", { name: "Documents", exact: true })
  await expect(tree).toBeVisible()
  const editor = page.locator(".ProseMirror").first()
  await editor.click()

  await page.keyboard.press("Control+.")
  await expect(tree).toBeHidden()

  await page.keyboard.press("Escape")
  await expect(tree).toBeVisible()
})
