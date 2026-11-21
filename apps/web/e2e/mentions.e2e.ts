import { expect, test } from "@playwright/test"
import { api, mentionDoc, randomProjectKey, taskNumber, unique } from "./helpers.ts"

interface ProjectDetail {
  readonly id: string
  readonly key: string
}
interface Board {
  readonly id: string
}
interface CreatedTask {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly version: number
}
interface CreatedDoc {
  readonly id: string
  readonly title: string
}
interface Channel {
  readonly id: string
}

test("a task mention in a chat message is a chip that opens the task", async ({ page }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Mention project"),
  })
  const [board] = await api<ReadonlyArray<Board>>(
    page.request,
    "GET",
    `/api/projects/${project.id}/boards`,
  )
  if (board === undefined) throw new Error("project has no board")
  const taskTitle = unique("Mentioned task")
  const task = await api<CreatedTask>(page.request, "POST", `/api/boards/${board.id}/tasks`, {
    title: taskTitle,
  })
  const channel = await api<Channel>(page.request, "POST", "/api/chat/channels", {
    name: unique("mention room").toLowerCase().replaceAll(" ", "-"),
    kind: "public",
  })
  await api(page.request, "POST", `/api/chat/channels/${channel.id}/messages`, {
    body: mentionDoc({ id: task.id, type: "task", label: taskTitle }),
  })

  const href = `/p/${key}/t/${taskNumber(task.key)}`
  await page.goto(`/c/${channel.id}`)
  const chip = page.locator(`a[href="${href}"]`).first()
  await expect(chip).toBeVisible()
  await chip.click()

  await expect(page).toHaveURL(new RegExp(`${href}$`))
})

test("a doc mention in a task description is a chip that opens the doc", async ({ page }) => {
  const key = randomProjectKey()
  const project = await api<ProjectDetail>(page.request, "POST", "/api/projects", {
    key,
    name: unique("Mention project"),
  })
  const doc = await api<CreatedDoc>(page.request, "POST", "/api/docs", {
    parentId: project.id,
    title: unique("Linked doc"),
  })
  const [board] = await api<ReadonlyArray<Board>>(
    page.request,
    "GET",
    `/api/projects/${project.id}/boards`,
  )
  if (board === undefined) throw new Error("project has no board")
  const task = await api<CreatedTask>(page.request, "POST", `/api/boards/${board.id}/tasks`, {
    title: unique("Task with a doc"),
  })
  await api(page.request, "PATCH", `/api/tasks/${task.id}`, {
    description: mentionDoc({ id: doc.id, type: "doc", label: doc.title }),
    version: task.version,
  })

  const taskPath = `/p/${key}/t/${taskNumber(task.key)}`
  const docPath = `/p/${key}/docs/${doc.id}`
  await page.goto(taskPath)
  const chip = page.locator(`a[href="${docPath}"]`).first()
  await expect(chip).toBeVisible()
  await chip.click()

  await expect(page).toHaveURL(new RegExp(`${docPath}$`))
})
