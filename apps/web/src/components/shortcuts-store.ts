import { useSyncExternalStore } from "react"

/** Module store so any component (sidebar menu, `?` key) can open the shortcuts dialog. */
let open = false
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const setShortcutsHelpOpen = (next: boolean): void => {
  if (open === next) return
  open = next
  emit()
}

export const toggleShortcutsHelp = (): void => setShortcutsHelpOpen(!open)

export const openShortcutsHelp = (): void => setShortcutsHelpOpen(true)

export const useShortcutsHelpOpen = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
