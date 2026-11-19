import { expect, test } from "@playwright/test"
import { api, randomProjectKey, unique } from "./helpers.ts"
import { startMockOpenAi } from "./support/mock-openai.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface BoardSummary {
  readonly id: string
  readonly columns: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

const PROVIDER_KEY = "sk-e2e-mock-Zq81Lw4x"

test("the assistant proposes a task and approving it adds the task to the board", async ({
  page,
}) => {
  const mock = startMockOpenAi()
  try {
    const key = randomProjectKey()
    const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
      key,
      name: unique("Assistant project"),
    })
    const [board] = await api<ReadonlyArray<BoardSummary>>(
      page.request,
      "GET",
      `/api/projects/${project.id}/boards`,
    )
    const column = board?.columns[0]
    if (column === undefined) throw new Error("the new project has no board column")

    const title = unique("Assistant task")
    const scripted = await fetch(`${mock.url}/__script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        columnId: column.id,
        title,
        description: "Created from the assistant e2e test.",
        reply: "I proposed the task. Approve it to add it to the board.",
      }),
    })
    expect(scripted.ok).toBe(true)

    // Configure the mock as the workspace's OpenAI-compatible provider.
    const providerName = unique("Mock provider")
    await page.goto("/admin/ai")
    await page.locator("#aiProviderKind").click()
    await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click()
    await page.locator("#aiProviderName").fill(providerName)
    await page.locator("#aiProviderBaseUrl").fill(`${mock.url}/v1`)
    await page.locator("#aiProviderApiKey").fill(PROVIDER_KEY)
    await page.locator("#aiProviderChatModel").fill("mock-chat")
    await page.getByRole("button", { name: "Add provider", exact: true }).click()
    await expect(page.getByText("Provider added", { exact: true })).toBeVisible()

    // The key is shown only as its last four characters.
    await expect(page.getByText(/••••Lw4x/).first()).toBeVisible()
    await expect(page.locator("body")).not.toContainText(PROVIDER_KEY)

    await page.locator("#aiEnabled").click()
    await page.locator("#feature-assistant").click()
    await page.locator("#defaultProvider").click()
    await page.getByRole("option", { name: providerName, exact: true }).click()
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByText("AI settings saved", { exact: true })).toBeVisible()

    // Ask the assistant on the project board.
    await page.goto(`/p/${key}/board`)
    await page.getByRole("button", { name: "Assistant", exact: true }).click()
    const composer = page.getByRole("textbox", { name: "Message the assistant", exact: true })
    await composer.fill(`Create a task called "${title}"`)
    await composer.press("Enter")

    await expect(page.getByText("The assistant replied.", { exact: true })).toBeVisible()
    const proposal = page.getByRole("region", { name: "Create task", exact: true })
    await expect(proposal).toBeVisible()
    await expect(proposal).toContainText(title)
    await proposal.screenshot({ path: "test-results/ai-proposal-card.png" })

    await proposal.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(proposal).toContainText("Approved")

    // The panel stays open over the board; close it to see the board.
    await page.keyboard.press("Escape")
    await page.reload()
    const columnRegion = page.getByRole("region", { name: column.name, exact: true })
    await expect(columnRegion.getByRole("button", { name: title, exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/ai-board.png", fullPage: true })
  } finally {
    mock.stop()
  }
})
