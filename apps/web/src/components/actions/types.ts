import type { LucideIcon } from "lucide-react"
import type { ColumnId } from "@audit/domain/ids"
import type { ChannelSummary, Message } from "@audit/domain/chat/schema"
import type { EventOccurrence, CalendarSummary } from "@audit/domain/calendar/schema"
import type { EntityRef, DocNode } from "@audit/domain/docs/schema"
import type { Member } from "@audit/domain/identity/schema"
import type { Notification } from "@audit/domain/notifications/schema"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import type { TaskCard } from "@audit/domain/tasks/schema"

/** Text shown in the shared confirm dialog before a destructive action runs. */
export interface ActionConfirm {
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  /** When set, the user must type this exact text (e.g. a project key) before confirming. */
  readonly typeToConfirm?: string | undefined
}

export interface EntityAction {
  readonly id: string
  readonly label: string
  readonly icon?: LucideIcon | undefined
  readonly shortcut?: string | undefined
  readonly variant?: "default" | "destructive" | undefined
  readonly disabled?: boolean | undefined
  /** Shown as a trailing description when `disabled` is set. */
  readonly disabledReason?: string | undefined
  /** Data this action depends on is still loading; renders a spinner and disables the item. */
  readonly pending?: boolean | undefined
  readonly run?: (() => void) | undefined
  /** Destructive actions set this; the menu runs `run` only after the confirm dialog. */
  readonly confirm?: ActionConfirm | undefined
  readonly children?: ReadonlyArray<EntityAction> | undefined
}

/** A group renders separated from the next one. */
export type ActionGroup = ReadonlyArray<EntityAction>

/** A board column the card may move to. */
export interface MoveColumn {
  readonly id: ColumnId
  readonly name: string
}

/**
 * What a menu acts on. Callbacks exist only where the dialog that the action opens
 * is owned by the parent view; the hooks never mount dialogs themselves.
 * Menus whose data is loaded lazily receive `open` from the wrapper, so queries
 * run only once the menu is opened.
 */
export type EntityTarget =
  | {
      readonly kind: "task"
      readonly task: TaskCard
      /** Columns of the card's board, for "Move to". Omitted when the caller has no board. */
      readonly columns?: ReadonlyArray<MoveColumn> | undefined
    }
  | {
      readonly kind: "doc"
      readonly doc: DocNode
      readonly projectKey?: string | undefined
      readonly onRename?: (() => void) | undefined
      readonly onNewSubDoc?: (() => void) | undefined
      readonly onOpenSide?: (() => void) | undefined
      readonly onOpenTab?: (() => void) | undefined
      readonly onOpenProperties?: (() => void) | undefined
    }
  | {
      readonly kind: "project"
      readonly project: ProjectSummary
      /** Parent-owned: runs after a successful delete, so the parent can navigate away. */
      readonly onDeleted?: (() => void) | undefined
    }
  | {
      readonly kind: "channel"
      readonly channel: ChannelSummary
      readonly onSettings?: (() => void) | undefined
    }
  | {
      readonly kind: "message"
      readonly message: Message
      readonly channelId: string
      readonly canPin: boolean
      readonly onReply?: (() => void) | undefined
      readonly onCreateTask?: (() => void) | undefined
      readonly onEdit?: (() => void) | undefined
    }
  | {
      readonly kind: "event"
      readonly event: EventOccurrence
      readonly onOpen?: (() => void) | undefined
    }
  | {
      readonly kind: "member"
      readonly member: Member
      readonly onOpenChannel?: (() => void) | undefined
      readonly onResetLink?: ((url: string) => void) | undefined
    }
  | {
      readonly kind: "notification"
      readonly notification: Notification
      /** Bulk selection: when set, the group applies to every item. */
      readonly items?: ReadonlyArray<Notification> | undefined
      readonly onOpen?: (() => void) | undefined
    }
  | {
      readonly kind: "calendar"
      readonly calendar: CalendarSummary
      readonly onEdit?: (() => void) | undefined
      readonly onImport?: (() => void) | undefined
    }
  | {
      readonly kind: "entity"
      readonly ref: EntityRef
      /** Fallback link for refs that carry no route data, e.g. search hits (`url`). */
      readonly href?: string | undefined
    }
