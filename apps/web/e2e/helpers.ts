import { expect, type APIRequestContext, type Page } from "@playwright/test"

/** Base URL of the running server (set by `bun run e2e`). */
export const BASE_URL = process.env.E2E_BASE_URL ?? ""

/** Setup token the runner passes to the server as `SETUP_TOKEN`. */
export const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? ""

/** Saved owner session written by `setup.e2e.ts`; relative to `apps/web`. */
export const OWNER_STATE = "e2e/.auth/owner.json"

export const WORKSPACE_NAME = "E2E Workspace"
export const OWNER = {
  name: "Olivia Owner",
  email: "owner@e2e.test",
  password: "correct horse battery staple",
}

/** Unique suffix so repeated runs against a shared server never collide. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}`

/** Random project key of 2 to 6 capital letters, starting with `Q` to stay clear of demo keys. */
export const randomProjectKey = () =>
  `Q${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}`

/** Calls the JSON API as the signed-in user of `request`'s context. Throws on a non-2xx status. */
export const api = async <T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> => {
  const response = await request.fetch(path, {
    method,
    data,
    headers: { origin: BASE_URL },
  })
  if (!response.ok()) {
    throw new Error(`${method} ${path} failed: ${response.status()} ${await response.text()}`)
  }
  return (await response.json()) as T
}

/** Signs the browser in through the login form and waits for the app shell. */
export const signIn = async (page: Page, email: string, password: string) => {
  await page.goto("/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** A ProseMirror document with one paragraph, the body shape chat messages and docs use. */
export const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})
