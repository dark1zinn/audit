import type { Notification } from "@audit/domain/notifications/schema"
import { i18n } from "../i18n.ts"

/** Where opening a notification goes. `null` means the kind has no page to open. */
export type InboxTarget =
  | { readonly to: "task"; readonly projectKey: string; readonly number: string }
  | { readonly to: "doc"; readonly docId: string }
  | { readonly to: "channel"; readonly channelId: string }
  | { readonly to: "thread"; readonly channelId: string; readonly threadId: string }
  | { readonly to: "calendar" }

const text = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Task keys look like `OPS-42`: the project key is everything before the last dash. */
const taskTarget = (taskKey: string): InboxTarget | null => {
  const dash = taskKey.lastIndexOf("-")
  if (dash <= 0) return null
  return { to: "task", projectKey: taskKey.slice(0, dash), number: taskKey.slice(dash + 1) }
}

export const targetOf = (notification: Notification): InboxTarget | null => {
  const { payload, kind } = notification
  const taskKey = text(payload, "taskKey")
  if (taskKey !== null) {
    const target = taskTarget(taskKey)
    if (target !== null) return target
  }
  const docId = text(payload, "docId")
  if (docId !== null) return { to: "doc", docId }
  const channelId = text(payload, "channelId")
  if (channelId !== null) {
    const rootId = text(payload, "rootId")
    if (kind === "thread_reply" && rootId !== null) {
      return { to: "thread", channelId, threadId: rootId }
    }
    return { to: "channel", channelId }
  }
  if (kind === "event_invited" || kind === "event_changed" || kind === "event_reminder") {
    return { to: "calendar" }
  }
  return null
}

/** The line shown under the title: a preview when the server sent one, else the item title. */
export const snippetOf = (notification: Notification): string =>
  text(notification.payload, "preview") ??
  text(notification.payload, "snippet") ??
  text(notification.payload, "title") ??
  ""

/** Notifications for one item (entity), newest first. */
export interface InboxGroup {
  readonly key: string
  readonly items: ReadonlyArray<Notification>
  readonly latest: Notification
  readonly unread: number
}

/** Groups already-sorted notifications (newest first) by the item they point at. */
export const groupByItem = (notifications: ReadonlyArray<Notification>): InboxGroup[] => {
  const byItem = new Map<string, Notification[]>()
  for (const notification of notifications) {
    const bucket = byItem.get(notification.entityId)
    if (bucket === undefined) byItem.set(notification.entityId, [notification])
    else bucket.push(notification)
  }
  return [...byItem].flatMap(([key, items]) => {
    const [latest] = items
    if (latest === undefined) return []
    return [{ key, items, latest, unread: items.filter((item) => item.readAt === null).length }]
  })
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
]

/** "3 hours ago" / "vor 3 Stunden" in the UI locale; "now" for anything under a minute. */
export const relativeTime = (date: Date, now: Date = new Date()): string => {
  const seconds = (date.getTime() - now.getTime()) / 1000
  const formatter = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(0, "second")
}
