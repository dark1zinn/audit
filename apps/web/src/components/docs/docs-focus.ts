import { useSyncExternalStore } from "react"

/** Focus mode is per session and not persisted: it hides chrome around the editor. */
let focused = false
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const setDocFocus = (on: boolean) => {
  if (focused === on) return
  focused = on
  for (const listener of listeners) listener()
}

export const toggleDocFocus = () => setDocFocus(!focused)

export const useDocFocus = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => focused,
    () => false,
  )
