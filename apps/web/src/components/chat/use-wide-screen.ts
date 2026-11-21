import { useSyncExternalStore } from "react"

const subscribeTo = (query: string) => (onChange: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const getServerSnapshot = () => false

/**
 * Tracks a CSS media query. Read synchronously on the client so layouts never flash the
 * wrong variant on first paint.
 */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    getServerSnapshot,
  )

/** True from `md` up. */
export const useWideScreen = (): boolean => useMediaQuery("(min-width: 768px)")
