import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup } from "@testing-library/react"
import type { EntityRef } from "@audit/domain/docs/schema"
import type { EntityId } from "@audit/domain/ids"
import { renderWithProviders } from "../../../test/render.tsx"

const { EntityChip } = await import("./entity-chip.tsx")
const { docKeys } = await import("../docs/queries.ts")

const id = "00000000-0000-4000-8000-000000000002" as EntityId

const seedRef = (ref: EntityRef) => (queryClient: import("@tanstack/react-query").QueryClient) =>
  queryClient.setQueryData(docKeys.entity(id), ref)

afterEach(cleanup)

describe("EntityChip", () => {
  test("a live doc renders a link to the doc", async () => {
    const view = await renderWithProviders(<EntityChip id={id} type="doc" label="old" />, {
      seed: seedRef({ id, type: "doc", title: "Roadmap", restricted: false, deleted: false }),
    })
    const link = await view.findByRole("link", { name: "Roadmap" })
    expect(link.getAttribute("href")).toBe(`/docs/${id}`)
  })

  test("a restricted item is not a link", async () => {
    const view = await renderWithProviders(<EntityChip id={id} type="doc" label="secret" />, {
      seed: seedRef({ id, type: "doc", restricted: true, deleted: false }),
    })
    expect(await view.findByText("Restricted item")).toBeTruthy()
    expect(view.queryByRole("link")).toBeNull()
  })

  test("a deleted item shows the stored label without a link", async () => {
    const view = await renderWithProviders(<EntityChip id={id} type="doc" label="Gone doc" />, {
      seed: seedRef({ id, type: "doc", title: "Gone doc", restricted: false, deleted: true }),
    })
    expect(await view.findByText("@Gone doc")).toBeTruthy()
    expect(view.queryByRole("link")).toBeNull()
  })
})
