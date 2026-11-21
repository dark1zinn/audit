import { createFileRoute } from "@tanstack/react-router"
import { SavedView } from "../components/chat/saved-threads.tsx"

export const Route = createFileRoute("/_app/_chat/saved")({
  component: SavedView,
})
