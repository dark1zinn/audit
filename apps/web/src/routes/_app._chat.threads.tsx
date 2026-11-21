import { createFileRoute } from "@tanstack/react-router"
import { ThreadsView } from "../components/chat/saved-threads.tsx"

export const Route = createFileRoute("/_app/_chat/threads")({
  component: ThreadsView,
})
