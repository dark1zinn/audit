import { useSyncExternalStore } from "react"

/** Module store so any component (header search button, menus) can open the palette. */
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

export const setCommandPaletteOpen = (next: boolean): void => {
  if (open === next) return
  open = next
  emit()
}

export const toggleCommandPalette = (): void => setCommandPaletteOpen(!open)

export const openCommandPalette = (): void => setCommandPaletteOpen(true)

export const useCommandPaletteOpen = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
