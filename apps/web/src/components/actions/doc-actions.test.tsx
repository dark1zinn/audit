import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, within } from "@testing-library/react"
import type { DocId, EntityId, UserId } from "@audit/domain/ids"
import type { DocDetail, DocNode } from "@audit/domain/docs/schema"
import type { Me } from "@audit/domain/identity/schema"
import { renderWithProviders } from "../../../test/render.tsx"
import type { EntityTarget } from "./types.ts"
// Loaded after dom.ts registers the Lingui macro mock; static imports evaluate too early.
const { sessionQuery } = await import("../../lib/queries.ts")
const { docQuery, docTreeQuery } = await import("../docs/queries.ts")
const { useDocActions } = await import("./doc-actions.ts")

type DocTarget = Extract<EntityTarget, { kind: "doc" }>

const ME = "user-me" as UserId
const OTHER = "user-other" as UserId

const makeDoc = (overrides: Partial<DocNode> = {}): DocNode => ({
  id: "doc-1" as DocId,
  parentId: "space-1" as EntityId,
  projectId: null,
  title: "Spec",
  icon: null,
  position: "a",
  restricted: false,
  reviewEveryDays: null,
  ownerUserId: null,
  verifiedAt: null,
  lastEditedAt: null,
  updatedAt: new Date(0),
  createdBy: OTHER,
  version: 1,
  ...overrides,
})

const makeMe = (): Me => ({
  userId: ME,
  email: "me@example.com",
  displayName: "Me",
  title: null,
  role: "member",
  timezone: "UTC",
  locale: null,
  twoFactorEnabled: false,
  twoFactorRequired: false,
  workspace: {
    name: "Audit",
    defaultLocale: "en",
    defaultTheme: "system",
    accentColor: "#000000",
    membersCanInvite: false,
  },
})

const Probe = ({ target }: { readonly target: DocTarget }) => {
  const groups = useDocActions(target, true)
  const del = groups.flat().find((action) => action.id === "delete")
  return (
    <div>
      <span data-testid="state">{del?.disabled ? "disabled" : "enabled"}</span>
      <span data-testid="reason">{del?.disabledReason ?? ""}</span>
      <span data-testid="confirm">{del?.confirm?.title ?? ""}</span>
    </div>
  )
}

const renderFor = async (
  doc: DocNode,
  myRole: DocDetail["myRole"],
  children: ReadonlyArray<DocNode>,
) => {
  const target: DocTarget = { kind: "doc", doc }
  return renderWithProviders(<Probe target={target} />, {
    seed: (queryClient) => {
      queryClient.setQueryData(sessionQuery.queryKey, makeMe())
      queryClient.setQueryData(docQuery(doc.id).queryKey, { ...doc, myRole })
      queryClient.setQueryData(docTreeQuery(null).queryKey, [doc, ...children])
    },
  })
}

const text = (testId: string) => within(document.body).getByTestId(testId).textContent ?? ""

afterEach(cleanup)

describe("doc delete rules", () => {
  test("creator editor can delete", async () => {
    await renderFor(makeDoc({ createdBy: ME }), "editor", [])
    expect(text("state")).toBe("enabled")
  })

  test("manager can delete someone else's doc", async () => {
    await renderFor(makeDoc(), "manager", [])
    expect(text("state")).toBe("enabled")
  })

  test("non-creator editor is disabled with the reason", async () => {
    await renderFor(makeDoc(), "editor", [])
    expect(text("state")).toBe("disabled")
    expect(text("reason")).toBe("Only the creator or a manager can delete this doc")
  })

  test("confirm text omits the count when there are no sub-docs", async () => {
    await renderFor(makeDoc({ createdBy: ME }), "manager", [])
    expect(text("confirm")).toBe("Delete “Spec”?")
  })

  test("confirm text uses the singular for one sub-doc", async () => {
    const doc = makeDoc({ createdBy: ME })
    const child = makeDoc({ id: "doc-2" as DocId, parentId: doc.id, title: "Child" })
    await renderFor(doc, "manager", [child])
    expect(text("confirm")).toBe("Delete “Spec” and its 1 sub-doc?")
  })

  test("confirm text counts several sub-docs", async () => {
    const doc = makeDoc({ createdBy: ME })
    const children = ["doc-2", "doc-3", "doc-4"].map((id) =>
      makeDoc({ id: id as DocId, parentId: doc.id, title: `Child ${id}` }),
    )
    await renderFor(doc, "manager", children)
    expect(text("confirm")).toBe("Delete “Spec” and its 3 sub-docs?")
  })
})
