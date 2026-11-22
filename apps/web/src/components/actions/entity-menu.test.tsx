import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import type { BoardId, ColumnId, ProjectId, TaskId } from "@audit/domain/ids"
import type { TaskCard } from "@audit/domain/tasks/schema"
import { renderWithProviders } from "../../../test/render.tsx"
import type { EntityTarget } from "./types.ts"
// Loaded after dom.ts registers the Lingui macro mock; static imports evaluate too early.
const { EntityContextMenu } = await import("./entity-menu.tsx")

const task: TaskCard = {
  id: "task-1" as TaskId,
  key: "OPS-1",
  projectId: "project-1" as ProjectId,
  projectKey: "OPS",
  boardId: "board-1" as BoardId,
  columnId: "col-1" as ColumnId,
  columnCategory: "todo",
  title: "Fix login",
  priority: "none",
  position: "a",
  assignees: [],
  labels: [],
  parentId: null,
  startAt: null,
  dueAt: null,
  estimate: null,
  completedAt: null,
  subtaskCount: 0,
  subtasksDone: 0,
  commentCount: 0,
  version: 1,
  updatedAt: new Date(0),
}

const target: EntityTarget = { kind: "task", task, columns: [] }

const Board = () => (
  <div>
    <EntityContextMenu target={target}>
      <button type="button">Fix login</button>
    </EntityContextMenu>
    <div data-testid="plain">Plain background</div>
  </div>
)

const page = () => within(document.body)

afterEach(cleanup)

describe("EntityContextMenu", () => {
  test("right-click on a wrapped task shows the menu with Delete last after a separator", async () => {
    await renderWithProviders(<Board />)
    fireEvent.contextMenu(page().getByRole("button", { name: "Fix login" }))
    const menu = await page().findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: /Move to/ })).toBeTruthy()
    const items = within(menu).getAllByRole("menuitem")
    expect(items[items.length - 1]?.textContent).toContain("Delete")
    expect(within(menu).getAllByRole("separator").length).toBeGreaterThan(0)
  })

  test("right-click on an unwrapped sibling is not prevented and shows no menu", async () => {
    await renderWithProviders(<Board />)
    const allowed = fireEvent.contextMenu(page().getByTestId("plain"))
    expect(allowed).toBe(true)
    expect(page().queryByRole("menu")).toBeNull()
  })

  test("Shift+F10 then the context menu key opens the menu with focus on the first item", async () => {
    await renderWithProviders(<Board />)
    const card = page().getByRole("button", { name: "Fix login" })
    card.focus()
    fireEvent.keyDown(card, { key: "F10", shiftKey: true })
    fireEvent.contextMenu(card)
    await page().findByRole("menu")
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("menuitem"))
  })
})
