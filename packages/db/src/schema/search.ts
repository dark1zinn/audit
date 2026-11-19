import { primaryKey, index, pgTable, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { timestamptz } from "./columns.ts"
import { entities } from "./core.ts"

/** Entities a user last opened. Feeds the quick find's recent list; one row per user and entity. */
export const recentItems = pgTable(
  "recent_items",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    viewedAt: timestamptz("viewed_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityId] }),
    index("recent_items_user_viewed_idx").on(t.userId, t.viewedAt),
  ],
)
