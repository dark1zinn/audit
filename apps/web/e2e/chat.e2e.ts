import { expect, test } from "@playwright/test"
import { api, paragraph, unique } from "./helpers.ts"

interface Channel {
  readonly id: string
}
interface Message {
  readonly id: string
}

test("a reply in a message thread shows up in the thread", async ({ page }) => {
  const channelName = unique("thread room").toLowerCase().replaceAll(" ", "-")
  const channel = await api<Channel>(page.request, "POST", "/api/chat/channels", {
    name: channelName,
    kind: "public",
  })
  const rootText = unique("Root message")
  await api<Message>(page.request, "POST", `/api/chat/channels/${channel.id}/messages`, {
    body: paragraph(rootText),
  })

  await page.goto(`/c/${channel.id}`)
  const root = page.getByRole("article", { name: "Message", exact: true }).filter({
    hasText: rootText,
  })
  await expect(root).toBeVisible()
  await root.hover()
  await root.getByRole("button", { name: "Reply", exact: true }).click()

  const composer = page.getByRole("textbox", { name: "Reply in thread", exact: true })
  await expect(composer).toBeVisible()
  const replyText = unique("Thread reply")
  await composer.click()
  await page.keyboard.type(replyText)
  await page.keyboard.press("Enter")

  await expect(page.getByRole("complementary", { name: "Thread", exact: true })).toContainText(
    replyText,
  )
})
