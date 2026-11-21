import "../../../test/dom.ts"
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, within } from "@testing-library/react"
import type { BoardId, ColumnId, ProjectId, TaskId } from "@audit/domain/ids"
import type { TaskCard as TaskCardModel } from "@audit/domain/tasks/schema"
import { renderWithProviders } from "../../../test/render.tsx"
// Loaded after dom.ts registers the Lingui macro mock; static imports evaluate too early.
const { SortableTaskCard } = await import("./task-card.tsx")

const card: TaskCardModel = {
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

const columns = [
  { id: "col-1" as ColumnId, name: "To do" },
  { id: "col-2" as ColumnId, name: "In progress" },
]

const Card = () => (
  <SortableTaskCard
    card={card}
    columnId="col-1"
    columns={columns}
    labels={new Map()}
    members={new Map()}
    selected={false}
    reduced
    onFocus={() => {}}
    onToggle={() => {}}
    onOpen={() => {}}
  />
)

const page = () => within(document.body)

afterEach(cleanup)

describe("SortableTaskCard actions", () => {
  test("right-click on a card opens a menu offering Move to", async () => {
    await renderWithProviders(<Card />)
    fireEvent.contextMenu(page().getByRole("button", { name: "Fix login" }))
    const menu = await page().findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: /Move to/ })).toBeTruthy()
  })

  test("the visible actions button opens the same menu", async () => {
    await renderWithProviders(<Card />)
    const trigger = page().getByRole("button", { name: /Actions for OPS-1/ })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(trigger)
    const menu = await page().findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: /Move to/ })).toBeTruthy()
  })
})
