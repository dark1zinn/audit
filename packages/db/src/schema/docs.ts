import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { createdAt, entityPk, id, timestamptz } from "./columns.ts"
import { entities, projects } from "./core.ts"

/** Yjs document state. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
})

export const docVersionKinds = ["auto", "named", "restore"] as const

/**
 * A doc is an item: its `entities` row carries the tree (`parent_id` = project, space or parent
 * doc), grants and restriction. `position` orders siblings (fractional index).
 */
export const docs = pgTable(
  "docs",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    parentDocId: uuid("parent_doc_id").references((): AnyPgColumn => docs.id),
    projectId: uuid("project_id").references(() => projects.id),
    position: text("position").notNull(),
    icon: text("icon"),
    ydoc: bytea("ydoc"),
    content: jsonb("content").$type<Record<string, unknown>>(),
    contentText: text("content_text").notNull().default(""),
    lastEditedBy: uuid("last_edited_by").references(() => user.id),
    lastEditedAt: timestamptz("last_edited_at"),
    reviewEveryDays: integer("review_every_days"),
    ownerUserId: uuid("owner_user_id").references(() => user.id),
    verifiedAt: timestamptz("verified_at"),
    /** When the owner was last told the doc is due for review; cleared by `verify`. */
    reviewNotifiedAt: timestamptz("review_notified_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("docs_parent_idx").on(t.parentDocId, t.position),
    index("docs_project_idx").on(t.projectId),
    check("docs_review_days_check", sql`${t.reviewEveryDays} is null or ${t.reviewEveryDays} > 0`),
  ],
)

/** Point-in-time snapshots of a doc's Yjs state and JSON content. */
export const docVersions = pgTable(
  "doc_versions",
  {
    id: id(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: bytea("snapshot").notNull(),
    content: jsonb("content").notNull().$type<Record<string, unknown>>(),
    label: text("label"),
    kind: text("kind").notNull().$type<(typeof docVersionKinds)[number]>(),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("doc_versions_doc_version_uq").on(t.docId, t.version),
    check("doc_versions_kind_check", sql`${t.kind} in ('auto', 'named', 'restore')`),
  ],
)
