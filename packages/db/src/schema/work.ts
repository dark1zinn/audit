import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { createdAt, entityPk, id, timestamptz } from "./columns.ts"
import { entities, projects } from "./core.ts"

const inList = (column: AnyPgColumn, values: ReadonlyArray<string>) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`

export const columnCategories = ["backlog", "todo", "in_progress", "done", "canceled"] as const
export const taskPriorities = ["none", "low", "medium", "high", "urgent"] as const
export const notificationKinds = [
  "task_due_soon",
  "task_overdue",
  "task_assigned",
  "mention",
  "doc_review_due",
  "direct_message",
  "thread_reply",
  "task_unassigned",
  "task_changed",
  "comment_added",
  "invite_accepted",
  "event_invited",
  "event_changed",
  "event_reminder",
] as const

/** A board belongs to a project. Its access grants live in `container_access` like other containers. */
export const boards = pgTable(
  "boards",
  {
    id: entityPk().references(() => entities.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    position: text("position").notNull(),
  },
  (t) => [index("boards_project_idx").on(t.projectId, t.position)],
)

export const boardColumns = pgTable(
  "board_columns",
  {
    id: id(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull().$type<(typeof columnCategories)[number]>(),
    position: text("position").notNull(),
    wipLimit: integer("wip_limit"),
  },
  (t) => [
    check("board_columns_category_check", inList(t.category, columnCategories)),
    check("board_columns_wip_check", sql`${t.wipLimit} is null or ${t.wipLimit} > 0`),
    uniqueIndex("board_columns_position_uniq").on(t.boardId, t.position),
  ],
)

export const tasks = pgTable(
  "tasks",
  {
    id: entityPk().references(() => entities.id),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id),
    columnId: uuid("column_id")
      .notNull()
      .references(() => boardColumns.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    position: text("position").notNull(),
    priority: text("priority").notNull().$type<(typeof taskPriorities)[number]>().default("none"),
    startAt: timestamptz("start_at"),
    dueAt: timestamptz("due_at"),
    estimate: integer("estimate"),
    description: jsonb("description").$type<Record<string, unknown>>(),
    completedAt: timestamptz("completed_at"),
    /** Last reminder sent for `dueAt`; prevents repeat notifications for the same due date. */
    dueNotifiedAt: timestamptz("due_notified_at"),
    overdueNotifiedAt: timestamptz("overdue_notified_at"),
  },
  (t) => [
    check("tasks_priority_check", inList(t.priority, taskPriorities)),
    check("tasks_estimate_check", sql`${t.estimate} is null or ${t.estimate} between 0 and 1000`),
    uniqueIndex("tasks_project_number_uniq").on(t.projectId, t.number),
    index("tasks_column_position_idx").on(t.columnId, t.position),
    index("tasks_board_idx").on(t.boardId),
    index("tasks_due_idx").on(t.dueAt),
  ],
)

export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_assignees_user_idx").on(t.userId),
  ],
)

export const labels = pgTable(
  "labels",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (t) => [
    uniqueIndex("labels_project_name_uniq").on(t.projectId, t.name),
    check("labels_color_check", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
)

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
)

export const comments = pgTable(
  "comments",
  {
    id: entityPk().references(() => entities.id),
    targetId: uuid("target_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    body: jsonb("body").notNull().$type<Record<string, unknown>>(),
    bodyText: text("body_text").notNull().default(""),
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => comments.id),
    resolvedAt: timestamptz("resolved_at"),
    editedAt: timestamptz("edited_at"),
  },
  (t) => [index("comments_target_idx").on(t.targetId, t.id)],
)

export const savedFilters = pgTable(
  "saved_filters",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: jsonb("filter").notNull().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("saved_filters_user_idx").on(t.userId, t.projectId)],
)

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<(typeof notificationKinds)[number]>(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => user.id),
    payload: jsonb("payload").notNull().default({}).$type<Record<string, unknown>>(),
    groupKey: text("group_key").notNull(),
    readAt: timestamptz("read_at"),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("notifications_kind_check", inList(t.kind, notificationKinds)),
    index("notifications_inbox_idx").on(t.userId, t.archivedAt, t.createdAt),
    index("notifications_group_idx").on(t.userId, t.groupKey),
    index("notifications_entity_idx").on(t.entityId),
  ],
)

export const notificationChannels = ["in_app", "push", "email"] as const

/** Per-person channel switches. A missing row means the default; see `optInNotificationKinds`. */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<(typeof notificationKinds)[number]>(),
    channel: text("channel").notNull().$type<(typeof notificationChannels)[number]>(),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.channel] }),
    check("notification_prefs_kind_check", inList(t.kind, notificationKinds)),
    check("notification_prefs_channel_check", inList(t.channel, notificationChannels)),
  ],
)

/** A browser push endpoint for one person. Removed when the push service reports it gone. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
)
