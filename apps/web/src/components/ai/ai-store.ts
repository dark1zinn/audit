import { useEffect, useSyncExternalStore } from "react"
import type { EntityId } from "@audit/domain/ids"

interface AssistantState {
  readonly open: boolean
  /** Item the current page is about; pages register it with `useAiPageContext`. */
  readonly pageContext: EntityId | null
  /** Text to place in the composer the next time the panel shows (for example "break down"). */
  readonly prompt: { readonly text: string; readonly key: number } | null
}

let state: AssistantState = { open: false, pageContext: null, prompt: null }
let owner: object | null = null
const listeners = new Set<() => void>()

const update = (next: Partial<AssistantState>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => state

/** Opens or closes the assistant panel. */
export const setAssistantOpen = (open: boolean) => update({ open })

/** Opens the panel and prefills its composer with `text`. */
export const openAssistantWith = (text: string) =>
  update({ open: true, prompt: { text, key: Date.now() } })

/** Reads the assistant panel state; re-renders on change. */
export const useAssistantState = (): AssistantState =>
  useSyncExternalStore(subscribe, snapshot, snapshot)

export const consumePrompt = () => update({ prompt: null })

/**
 * Tells the assistant which item the current page shows. Cleared again when the page unmounts,
 * unless another page has registered since.
 */
export const useAiPageContext = (entityId: EntityId | null) => {
  useEffect(() => {
    if (entityId === null) return
    const token = {}
    owner = token
    update({ pageContext: entityId })
    return () => {
      if (owner !== token) return
      owner = null
      update({ pageContext: null })
    }
  }, [entityId])
}
