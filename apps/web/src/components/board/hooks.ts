import { useLingui } from "@lingui/react/macro"
import { useEffect, useSyncExternalStore } from "react"
import type { ColumnCategory } from "@audit/domain/projects/schema"
import type { Priority } from "@audit/domain/tasks/schema"

export type ShortcutHandlers = Readonly<Record<string, () => void>>

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true
  return target.closest('[role="dialog"], [role="listbox"], [role="menu"]') !== null
}

/** Single-key board shortcuts. Disabled while typing or inside dialogs/menus. */
export const useBoardShortcuts = (handlers: ShortcutHandlers) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const handler = handlers[event.key]
      if (handler === undefined) return
      event.preventDefault()
      handler()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handlers])
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )

export const PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies ReadonlyArray<Priority>

export const COLUMN_CATEGORIES = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const satisfies ReadonlyArray<ColumnCategory>

export const usePriorityLabels = (): Readonly<Record<Priority, string>> => {
  const { t } = useLingui()
  return {
    none: t`No priority`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
    urgent: t`Urgent`,
  }
}

export const useCategoryLabels = (): Readonly<Record<ColumnCategory, string>> => {
  const { t } = useLingui()
  return {
    backlog: t`Backlog`,
    todo: t`To do`,
    in_progress: t`In progress`,
    done: t`Done`,
    canceled: t`Canceled`,
  }
}
