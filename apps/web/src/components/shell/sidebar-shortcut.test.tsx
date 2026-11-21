import "../../../test/dom.ts"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { renderWithProviders } from "../../../test/render.tsx"
import { Sidebar, SidebarContent, SidebarProvider } from "@audit/ui/components/ui/sidebar.tsx"

function Shell() {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarContent>
          <input aria-label="Search field" />
          <div contentEditable suppressContentEditableWarning aria-label="Editor">
            text
          </div>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}

const sidebarState = (container: ParentNode) =>
  container.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe("sidebar Ctrl+\\ shortcut", () => {
  test("toggles the sidebar when focus is on the page", async () => {
    const { container } = await renderWithProviders(<Shell />)
    expect(sidebarState(container)).toBe("expanded")
    fireEvent.keyDown(document.body, { key: "\\", ctrlKey: true })
    expect(sidebarState(container)).toBe("collapsed")
  })

  test("is ignored while typing in an input", async () => {
    const { container, getByLabelText } = await renderWithProviders(<Shell />)
    fireEvent.keyDown(getByLabelText("Search field"), { key: "\\", ctrlKey: true })
    expect(sidebarState(container)).toBe("expanded")
  })

  test("is ignored inside a contenteditable editor", async () => {
    const { container, getByLabelText } = await renderWithProviders(<Shell />)
    fireEvent.keyDown(getByLabelText("Editor"), { key: "\\", ctrlKey: true })
    expect(sidebarState(container)).toBe("expanded")
  })
})
