import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import type { Me } from "@audit/domain/identity/schema"
import { renderWithProviders } from "../../../test/render.tsx"
// Loaded after dom.ts registers the Lingui macro mock.
const { MobileTabBar } = await import("./mobile-tab-bar.tsx")

afterEach(cleanup)

const me = {
  id: "user-1",
  role: "member",
  locale: "en",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  workspace: { name: "Audit" },
} as unknown as Me

describe("MobileTabBar", () => {
  test("renders the five primary items inside the Primary landmark", async () => {
    const { getByRole } = await renderWithProviders(<MobileTabBar me={me} />, { route: "/" })
    const nav = getByRole("navigation", { name: "Primary" })
    const items =
      within(nav).getAllByRole("link").length + within(nav).getAllByRole("button").length
    expect(items).toBe(5)
    expect(within(nav).getByRole("button", { name: /More/ })).toBeDefined()
  })

  test("marks the route the user is on with aria-current", async () => {
    const { getByRole } = await renderWithProviders(<MobileTabBar me={me} />, {
      route: "/inbox",
    })
    const nav = getByRole("navigation", { name: "Primary" })
    expect(within(nav).getByRole("link", { name: /Inbox/ }).getAttribute("aria-current")).toBe(
      "page",
    )
    expect(within(nav).getByRole("link", { name: /Home/ }).getAttribute("aria-current")).toBeNull()
  })
})
