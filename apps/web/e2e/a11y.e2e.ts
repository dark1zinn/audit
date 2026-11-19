import AxeBuilder from "@axe-core/playwright"
import { expect, test, type BrowserContext } from "@playwright/test"
import { OWNER_STATE, api, randomProjectKey, unique } from "./helpers.ts"

/** Every main route of the signed-in app. `{project}` and `{channel}` are filled from fixtures. */
const ROUTES: ReadonlyArray<string> = [
  "/",
  "/search",
  "/inbox",
  "/docs",
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

const BLOCKING_IMPACTS: ReadonlyArray<string> = ["serious", "critical"]

const fixtures: { projectKey: string; channelId: string } = { projectKey: "", channelId: "" }

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER_STATE })
  try {
    fixtures.projectKey = randomProjectKey()
    await api(context.request, "POST", "/api/projects", {
      key: fixtures.projectKey,
      name: unique("A11y project"),
    })
    const channel = await api<{ id: string }>(context.request, "POST", "/api/chat/channels", {
      name: unique("a11y room").toLowerCase().replaceAll(" ", "-"),
      kind: "public",
    })
    fixtures.channelId = channel.id
  } finally {
    await context.close()
  }
})

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
      const path = route
        .replace("{project}", fixtures.projectKey)
        .replace("{channel}", fixtures.channelId)
      const page = await context.newPage()
      await page.goto(path)
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
    })
  }
})
