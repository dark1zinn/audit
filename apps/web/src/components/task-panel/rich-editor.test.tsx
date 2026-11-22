import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup } from "@testing-library/react"
import type { EntityRef } from "@audit/domain/docs/schema"
import type { EntityId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { renderWithProviders } from "../../../test/render.tsx"
import { docKeys } from "../docs/queries.ts"

// Dynamic: the Lingui macro mock in test/dom.ts must be installed before RichEditor's import graph loads.
const { RichEditor } = await import("./rich-editor.tsx")

const taskId = "00000000-0000-4000-8000-000000000003" as EntityId

const doc: RichDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "mention", attrs: { id: taskId, type: "task", label: "KEY-3" } }],
    },
  ],
}

const ref: EntityRef = {
  id: taskId,
  type: "task",
  title: "Fix login",
  key: "KEY-3",
  projectKey: "KEY",
  number: 3,
  restricted: false,
  deleted: false,
}

afterEach(cleanup)

describe("RichEditor", () => {
  test("a read-only task mention renders a link to the task", async () => {
    const view = await renderWithProviders(
      <RichEditor value={doc} editable={false} label="Description" />,
      {
        seed: (queryClient) => queryClient.setQueryData(docKeys.entity(taskId), ref),
      },
    )
    const link = await view.findByRole("link", { name: "Fix login" })
    expect(link.getAttribute("href")).toBe("/p/KEY/t/3")
  })
})
