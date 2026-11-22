import { useCallback, useState } from "react"

const read = (key: string, fallback: boolean): boolean => {
  if (typeof localStorage === "undefined") return fallback
  const raw = localStorage.getItem(key)
  if (raw === "true") return true
  if (raw === "false") return false
  return fallback
}

/** A boolean kept in localStorage so layout choices survive reloads. */
export const usePersistedBoolean = (key: string, fallback: boolean) => {
  const [value, setValue] = useState(() => read(key, fallback))
  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      if (typeof localStorage !== "undefined") localStorage.setItem(key, String(next))
    },
    [key],
  )
  return [value, update] as const
}
