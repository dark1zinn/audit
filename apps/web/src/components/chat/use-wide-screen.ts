import { useSyncExternalStore } from "react"

const WIDE_QUERY = "(min-width: 768px)"

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(WIDE_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const getSnapshot = () => window.matchMedia(WIDE_QUERY).matches
const getServerSnapshot = () => false

/**
 * True from `md` up. Read synchronously on the client so the chat layout never flashes the
 * mobile list before switching to the two-column view.
 */
export const useWideScreen = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
