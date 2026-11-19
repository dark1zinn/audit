import { useLingui } from "@lingui/react/macro"
import {
  AtSign,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  FileCheck,
  MessageCircle,
  MessageSquare,
  Pencil,
  Reply,
  TriangleAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react"

/** Notification kinds the server emits; `Notification.kind` is a plain string on the wire. */
export const NOTIFICATION_KINDS = [
  "task_due_soon",
  "task_overdue",
  "task_assigned",
  "task_unassigned",
  "task_changed",
  "mention",
  "comment_added",
  "doc_review_due",
  "direct_message",
  "thread_reply",
  "invite_accepted",
  "event_invited",
  "event_changed",
  "event_reminder",
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

const isKind = (kind: string): kind is NotificationKind =>
  (NOTIFICATION_KINDS as ReadonlyArray<string>).includes(kind)

const ICONS: Record<NotificationKind, LucideIcon> = {
  task_due_soon: CalendarClock,
  task_overdue: TriangleAlert,
  task_assigned: UserPlus,
  task_unassigned: UserMinus,
  task_changed: Pencil,
  mention: AtSign,
  comment_added: MessageCircle,
  doc_review_due: FileCheck,
  direct_message: MessageSquare,
  thread_reply: Reply,
  invite_accepted: UserCheck,
  event_invited: CalendarPlus,
  event_changed: CalendarDays,
  event_reminder: Bell,
}

/** Translated kind name. Unknown kinds from a newer server fall back to a generic label. */
export const useKindText = (): ((kind: string) => string) => {
  const { t } = useLingui()
  const labels: Record<NotificationKind, string> = {
    task_due_soon: t`Task due soon`,
    task_overdue: t`Task overdue`,
    task_assigned: t`Task assigned`,
    task_unassigned: t`Task unassigned`,
    task_changed: t`Task changed`,
    mention: t`Mention`,
    comment_added: t`New comment`,
    doc_review_due: t`Doc review due`,
    direct_message: t`Direct message`,
    thread_reply: t`Thread reply`,
    invite_accepted: t`Invite accepted`,
    event_invited: t`Event invitation`,
    event_changed: t`Event changed`,
    event_reminder: t`Event reminder`,
  }
  const fallback = t`Notification`
  return (kind) => (isKind(kind) ? labels[kind] : fallback)
}

/** Decorative: the kind's text label sits next to it. */
export function KindIcon({ kind }: { readonly kind: string }) {
  const Icon = isKind(kind) ? ICONS[kind] : Bell
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}
