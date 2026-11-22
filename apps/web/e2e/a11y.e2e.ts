import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { OWNER_STATE, api, randomProjectKey, unique } from "./helpers.ts"

/** Every main route of the signed-in app. `{project}`, `{channel}` and `{doc}` are filled from fixtures. */
const ROUTES: ReadonlyArray<string> = [
  "/",
  "/search",
  "/inbox",
  "/projects",
  "/chat",
  "/docs",
  "/docs/{doc}",
  "/calendar",
  "/settings/profile",
  "/settings/security",
  "/settings/notifications",
  "/settings/privacy",
  "/p/{project}/board",
  "/c/{channel}",
  "/admin",
  "/admin/projects",
  "/admin/members",
  "/admin/invites",
  "/admin/teams",
  "/admin/audit",
  "/admin/workspace",
  "/admin/access",
  "/admin/security",
  "/admin/email",
  "/admin/storage",
  "/admin/retention",
  "/admin/branding",
  "/admin/maintenance",
]

/** Routes checked at a phone width, where the bottom tab bar and the sidebar sheet replace the rail. */
const MOBILE_ROUTES: ReadonlyArray<string> = ["/", "/inbox", "/chat", "/docs", "/p/{project}/board"]

const BLOCKING_IMPACTS: ReadonlyArray<string> = ["serious", "critical"]

const fixtures: { projectId: string; projectKey: string; channelId: string; docId: string } = {
  projectId: "",
  projectKey: "",
  channelId: "",
  docId: "",
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER_STATE })
  try {
    fixtures.projectKey = randomProjectKey()
    const project = await api<{ id: string }>(context.request, "POST", "/api/projects", {
      key: fixtures.projectKey,
      name: unique("A11y project"),
    })
    fixtures.projectId = project.id
    const channel = await api<{ id: string }>(context.request, "POST", "/api/chat/channels", {
      name: unique("a11y room").toLowerCase().replaceAll(" ", "-"),
      kind: "public",
    })
    fixtures.channelId = channel.id
    const doc = await api<{ id: string }>(context.request, "POST", "/api/docs", {
      parentId: project.id,
      title: unique("A11y doc"),
    })
    fixtures.docId = doc.id
  } finally {
    await context.close()
  }
})

const pathFor = (route: string) =>
  route
    .replace("{project}", fixtures.projectKey)
    .replace("{channel}", fixtures.channelId)
    .replace("{doc}", fixtures.docId)

/** Loads `route` and fails on any serious or critical axe violation. */
const expectNoBlockingViolations = async (page: Page, route: string) => {
  await page.goto(pathFor(route))
  await expect(page.locator("main").first()).toBeVisible()
  await page.waitForLoadState("networkidle")

  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    (violation) => violation.impact != null && BLOCKING_IMPACTS.includes(violation.impact),
  )
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([])
}

test.describe("accessibility", () => {
  let context: BrowserContext

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({ storageState: OWNER_STATE })
  })

  test.afterEach(async () => {
    await context.close()
  })

  for (const route of ROUTES) {
    test(`no serious or critical violations on ${route}`, async () => {
      await expectNoBlockingViolations(await context.newPage(), route)
    })
  }
})

test.describe("accessibility in dark theme", () => {
  let context: BrowserContext

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({ storageState: OWNER_STATE })
    await context.addInitScript(() => localStorage.setItem("audit.theme", "dark"))
  })

  test.afterEach(async () => {
    await context.close()
  })

  for (const route of ROUTES) {
    test(`no serious or critical violations on ${route} in dark theme`, async () => {
      const page = await context.newPage()
      await expectNoBlockingViolations(page, route)
      await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    })
  }
})

test.describe("accessibility on a phone", () => {
  let context: BrowserContext

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      storageState: OWNER_STATE,
      viewport: { width: 390, height: 844 },
    })
  })

  test.afterEach(async () => {
    await context.close()
  })

  for (const route of MOBILE_ROUTES) {
    test(`no serious or critical violations on ${route} at 390x844`, async () => {
      await expectNoBlockingViolations(await context.newPage(), route)
    })
  }
})

/** Sets the owner's profile locale; `null` restores the default. */
const setOwnerLocale = async (browser: Browser, locale: string | null) => {
  const context = await browser.newContext({ storageState: OWNER_STATE })
  try {
    await api(context.request, "PATCH", "/api/me/profile", { locale })
  } finally {
    await context.close()
  }
}

test.describe("translations", () => {
  test("the sidebar and the phone tab bar use the pt-BR labels", async ({ browser }) => {
    await setOwnerLocale(browser, "pt-BR")
    try {
      const desktop = await browser.newContext({ storageState: OWNER_STATE })
      try {
        const page = await desktop.newPage()
        await page.goto("/")
        await expect(page.getByRole("link", { name: "Início", exact: true }).first()).toBeVisible()
        await page.goto("/docs")
        await expect(page.getByRole("link", { name: "Docs", exact: true }).first()).toBeVisible()
      } finally {
        await desktop.close()
      }

      const phone = await browser.newContext({
        storageState: OWNER_STATE,
        viewport: { width: 390, height: 844 },
      })
      try {
        const page = await phone.newPage()
        await page.goto("/")
        const primary = page.getByRole("navigation", { name: "Principal", exact: true })
        await expect(primary).toBeVisible()
        await expect(primary.getByText("Início", { exact: true })).toBeVisible()
      } finally {
        await phone.close()
      }
    } finally {
      await setOwnerLocale(browser, null)
    }
  })
})
