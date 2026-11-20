// Reads the seeded workspace through the API so the scripts never hard-code ids.

import { getJson } from "./lib.js"

// Discovers ENG board tasks, public channels, and docs from one signed-in person's view.
export function discover(cookie) {
  const projects = getJson("/api/projects", cookie)
  const eng = projects.find((project) => project.key === "ENG")
  if (!eng) throw new Error("seed data missing: project ENG (run `audit seed --demo` first)")

  const view = getJson(`/api/boards/${eng.defaultBoardId}/view`, cookie)
  const columnIds = view.columns.map((column) => column.id)
  const tasks = view.columns.flatMap((column) => column.tasks.map((task) => task.id))

  const docs = getJson(`/api/projects/${eng.id}/docs`, cookie)
    .filter((doc) => !doc.restricted)
    .map((doc) => doc.id)

  const channels = getJson("/api/chat/channels", cookie)
    .filter((channel) => channel.kind === "public" && channel.isMember && !channel.archivedAt)
    .map((channel) => channel.id)

  if (tasks.length === 0 || docs.length === 0 || channels.length === 0) {
    throw new Error("seed data incomplete: no tasks, docs, or channels found")
  }

  return {
    boardId: eng.defaultBoardId,
    projectId: eng.id,
    columnIds,
    tasks,
    docs,
    channels,
    searches: ["release", "invoice", "latency", "audit", "playbook", "incident"],
  }
}
