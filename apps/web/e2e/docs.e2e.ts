import { expect, test } from "@playwright/test"
import { OWNER_STATE, api, randomProjectKey, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface CreatedDoc {
  readonly id: string
}

test("two sessions editing the same doc see each other's text", async ({ page, browser }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Docs project"),
  })
  const doc = await api<CreatedDoc>(page.request, "POST", "/api/docs", {
    parentId: project.id,
    title: unique("Co-edit"),
  })
  const path = `/p/${key}/docs/${doc.id}`

  const first = await browser.newContext({ storageState: OWNER_STATE })
  const second = await browser.newContext({ storageState: OWNER_STATE })
  try {
    const a = await first.newPage()
    const b = await second.newPage()
    await a.goto(path)
    await b.goto(path)

    const editorA = a.locator(".ProseMirror").first()
    const editorB = b.locator(".ProseMirror").first()
    await expect(editorA).toBeVisible()
    await expect(editorB).toBeVisible()

    const fromA = unique("typed in A")
    await editorA.click()
    await a.keyboard.type(fromA)
    await expect(editorB).toContainText(fromA, { timeout: 20_000 })

    const fromB = unique("typed in B")
    await editorB.click()
    await b.keyboard.press("End")
    await b.keyboard.type(` ${fromB}`)
    await expect(editorA).toContainText(fromB, { timeout: 20_000 })
  } finally {
    await first.close()
    await second.close()
  }
})
