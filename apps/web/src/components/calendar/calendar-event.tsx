import { useLingui } from "@lingui/react/macro"
import type { Temporal } from "temporal-polyfill"
import { createContext, useContext } from "react"
import type { EntityTarget } from "../actions/types.ts"
import { EntityContextMenu } from "../actions/entity-menu.tsx"

/** Event payload Schedule-X passes to custom slot components. */
export interface SlotEvent {
  readonly id: string | number
  readonly title: string
  readonly calendarId?: string
  readonly start: Temporal.ZonedDateTime | Temporal.PlainDate
}

/** Resolves a calendar event id to its context-menu target, provided by the board's owner. */
export const EventTargetContext = createContext<(id: string) => EntityTarget | undefined>(
  () => undefined,
)

const timeLabel = (start: SlotEvent["start"], locale: string): string | undefined => {
  if (!("hour" in start)) return undefined
  return start.toLocaleString(locale, { hour: "numeric", minute: "2-digit" })
}

function EventBody({
  event,
  focusable,
}: {
  readonly event: SlotEvent
  readonly focusable: boolean
}) {
  const { i18n } = useLingui()
  const cid = event.calendarId
  const time = timeLabel(event.start, i18n.locale)
  const targetFor = useContext(EventTargetContext)
  const target = targetFor(String(event.id))
  const body = (
    <div
      role={focusable ? "button" : undefined}
      tabIndex={focusable ? 0 : undefined}
      aria-label={focusable ? event.title : undefined}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-sm px-1.5 py-0.5 text-xs leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        backgroundColor: `var(--sx-color-${cid}-container)`,
        color: `var(--sx-color-on-${cid}-container)`,
        borderInlineStart: `4px solid var(--sx-color-${cid})`,
      }}
    >
      <span className="truncate font-medium">{event.title}</span>
      {time !== undefined && <span className="truncate text-[11px] opacity-80">{time}</span>}
    </div>
  )
  return target ? <EntityContextMenu target={target}>{body}</EntityContextMenu> : body
}

/** Time-grid slot: the inner element is the focus target, so keyboard users reach the menu. */
export function TimeGridEventSlot({ calendarEvent }: { readonly calendarEvent: SlotEvent }) {
  return <EventBody event={calendarEvent} focusable />
}

/**
 * Month-grid slot: Schedule-X's outer element already is the focusable button, so nesting another
 * one would be invalid. Only the pointer path opens the menu here.
 */
export function DateGridEventSlot({ calendarEvent }: { readonly calendarEvent: SlotEvent }) {
  return <EventBody event={calendarEvent} focusable={false} />
}
