import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { createdAt, entityPk, id, timestamptz, tsvector, updatedAt } from "./columns.ts"

const inList = (column: AnyPgColumn, values: ReadonlyArray<string>) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`

export const entityTypes = [
  "user",
  "team",
  "project",
  "board",
  "task",
  "doc",
  "comment",
  "channel",
  "message",
  "calendar",
  "event",
  "file",
  "space",
] as const

/**
 * One row per referenceable thing; each type table shares this row's ID. Anchors permissions,
 * references, search, the audit log and embeddings. `search` is maintained by a trigger from
 * `title` and `search_text` using the workspace's text-search configuration.
 */
export const entities = pgTable(
  "entities",
  {
    id: id(),
    type: text("type").notNull().$type<(typeof entityTypes)[number]>(),
    projectId: uuid("project_id").references((): AnyPgColumn => entities.id, {
      onDelete: "cascade",
    }),
    parentId: uuid("parent_id").references((): AnyPgColumn => entities.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    searchText: text("search_text").notNull().default(""),
    restricted: boolean("restricted").notNull().default(false),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz("deleted_at"),
    version: integer("version").notNull().default(1),
    search: tsvector("search"),
  },
  (t) => [
    check("entities_type_check", inList(t.type, entityTypes)),
    index("entities_search_gin").using("gin", t.search),
    index("entities_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
    index("entities_project_idx").on(t.projectId, t.type),
    index("entities_parent_idx").on(t.parentId),
  ],
)

/** Exactly one row. */
export const workspace = pgTable(
  "workspace",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(),
    logoFileId: uuid("logo_file_id"),
    settings: jsonb("settings").notNull().default({}),
    signupPolicy: jsonb("signup_policy").notNull().default({ mode: "closed", domains: [] }),
    searchConfig: text("search_config").notNull().default("english"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("workspace_singleton", sql`${t.id} = 1`),
    check(
      "workspace_search_config_check",
      inList(t.searchConfig, ["english", "portuguese", "spanish"]),
    ),
  ],
)

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    title: text("title"),
    timezone: text("timezone").notNull().default("UTC"),
    /** Quiet hours as local `HH:MM` in `timezone`; push and email wait until `quietEnd`. */
    quietStart: text("quiet_start"),
    quietEnd: text("quiet_end"),
    locale: text("locale"),
    avatarFileId: uuid("avatar_file_id"),
    icalTokenHash: text("ical_token_hash").unique(),
    lastSeenAt: timestamptz("last_seen_at"),
    deactivatedAt: timestamptz("deactivated_at"),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    check(
      "user_profiles_quiet_check",
      sql`(${t.quietStart} is null) = (${t.quietEnd} is null)
      and (${t.quietStart} is null or ${t.quietStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      and (${t.quietEnd} is null or ${t.quietEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
  ],
)

export const workspaceRoles = ["owner", "admin", "member", "guest"] as const

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<(typeof workspaceRoles)[number]>(),
    invitedBy: uuid("invited_by").references(() => user.id),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
  },
  (t) => [check("workspace_members_role_check", inList(t.role, workspaceRoles))],
)

export interface ProjectGrant {
  readonly projectId: string
  readonly role: "viewer" | "commenter" | "editor" | "manager"
}

/** Only the SHA-256 of the token is stored. */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email"),
    role: text("role").notNull().$type<"member" | "guest">(),
    teamIds: uuid("team_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    projectGrants: jsonb("project_grants")
      .notNull()
      .$type<ReadonlyArray<ProjectGrant>>()
      .default([]),
    expiresAt: timestamptz("expires_at").notNull(),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamptz("revoked_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("invites_role_check", inList(t.role, ["member", "guest"])),
    check("invites_uses_check", sql`${t.useCount} <= ${t.maxUses} and ${t.maxUses} >= 1`),
  ],
)

/**
 * Self sign-ups waiting for the emailed link (`tokenHash` set, only its SHA-256 stored) or an
 * admin decision (`tokenHash` null). The password is kept only as its argon2 hash. The row is
 * deleted when the account is created or the request is rejected.
 */
export const signupRequests = pgTable("signup_requests", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale"),
  timezone: text("timezone").notNull(),
  tokenHash: text("token_hash").unique(),
  expiresAt: timestamptz("expires_at"),
  createdAt: createdAt(),
})

export const resourceRoles = ["viewer", "commenter", "editor", "manager"] as const
type ResourceRoleColumn = (typeof resourceRoles)[number]

export const teams = pgTable(
  "teams",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: text("kind").notNull().$type<"workspace" | "project">(),
    projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    check("teams_kind_check", inList(t.kind, ["workspace", "project"])),
    check("teams_project_scope_check", sql`(${t.kind} = 'project') = (${t.projectId} is not null)`),
  ],
)

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<"member" | "lead">().default("member"),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index("team_members_user_idx").on(t.userId),
    check("team_members_role_check", inList(t.role, ["member", "lead"])),
  ],
)

export const projects = pgTable(
  "projects",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    leadUserId: uuid("lead_user_id").references(() => user.id),
    visibility: text("visibility").notNull().$type<"workspace" | "restricted">(),
    memberRole: text("member_role").notNull().$type<ResourceRoleColumn>().default("editor"),
    status: text("status").notNull().$type<"active" | "archived">().default("active"),
    taskSeq: integer("task_seq").notNull().default(0),
    /** Opt-in for the weekly AI digest; `aiDigestEnabledBy` is the person who turned it on. */
    aiDigest: boolean("ai_digest").notNull().default(false),
    aiDigestEnabledBy: uuid("ai_digest_enabled_by").references(() => user.id),
  },
  (t) => [
    check("projects_key_check", sql`${t.key} ~ '^[A-Z]{2,6}$'`),
    check("projects_visibility_check", inList(t.visibility, ["workspace", "restricted"])),
    check("projects_member_role_check", inList(t.memberRole, resourceRoles)),
    check("projects_status_check", inList(t.status, ["active", "archived"])),
  ],
)

/** Explicit grants. A `role` principal grants every member holding that workspace role. */
export const accessEntries = pgTable(
  "access_entries",
  {
    id: id(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull().$type<"user" | "team" | "role">(),
    principalId: uuid("principal_id"),
    principalRole: text("principal_role").$type<(typeof workspaceRoles)[number]>(),
    role: text("role").notNull().$type<ResourceRoleColumn>(),
    grantedBy: uuid("granted_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("access_entries_role_check", inList(t.role, resourceRoles)),
    check(
      "access_entries_principal_check",
      sql`(${t.principalType} = 'role') = (${t.principalRole} is not null and ${t.principalId} is null)`,
    ),
    uniqueIndex("access_entries_principal_uq")
      .on(t.resourceId, t.principalType, t.principalId)
      .where(sql`${t.principalId} is not null`),
    uniqueIndex("access_entries_role_uq")
      .on(t.resourceId, t.principalRole)
      .where(sql`${t.principalRole} is not null`),
    index("access_entries_principal_idx").on(t.principalType, t.principalId),
  ],
)

/** Materialised effective role per container and user, rebuilt on grant or membership changes. */
export const containerAccess = pgTable(
  "container_access",
  {
    containerId: uuid("container_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<ResourceRoleColumn>(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.containerId] }),
    index("container_access_container_idx").on(t.containerId),
  ],
)

export const referenceKinds = [
  "mention",
  "link",
  "embed",
  "blocks",
  "relates",
  "duplicates",
  "scheduled_for",
] as const

export const references = pgTable(
  "references",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<(typeof referenceKinds)[number]>(),
    snippet: text("snippet"),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("references_kind_check", inList(t.kind, referenceKinds)),
    uniqueIndex("references_source_target_kind_uq").on(t.sourceId, t.targetId, t.kind),
    index("references_target_kind_idx").on(t.targetId, t.kind),
  ],
)

/** Users who follow an entity's changes (tasks, docs, threads, events). */
export const watchers = pgTable(
  "watchers",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.userId] }), index("watchers_user_idx").on(t.userId)],
)

export const files = pgTable(
  "files",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => user.id),
    scanStatus: text("scan_status")
      .notNull()
      .$type<"skipped" | "pending" | "clean" | "infected">()
      .default("skipped"),
    unreferencedAt: timestamptz("unreferenced_at"),
  },
  (t) => [
    index("files_sha256_idx").on(t.sha256),
    check(
      "files_scan_status_check",
      inList(t.scanStatus, ["skipped", "pending", "clean", "infected"]),
    ),
  ],
)

/** Append-only and hash-chained; `seq`, `prev_hash` and `hash` are set by a trigger. */
export const trailEvents = pgTable(
  "trail_events",
  {
    id: id(),
    // seq, prev_hash and hash are overwritten by the trail_events_chain trigger.
    seq: bigint("seq", { mode: "number" }).notNull().unique().default(0),
    at: timestamptz("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull().$type<"user" | "ai" | "system">(),
    actorId: uuid("actor_id"),
    onBehalfOf: uuid("on_behalf_of"),
    action: text("action").notNull(),
    entityId: uuid("entity_id"),
    entityType: text("entity_type"),
    projectId: uuid("project_id"),
    diff: jsonb("diff"),
    meta: jsonb("meta").notNull().default({}),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    check("trail_events_actor_type_check", inList(t.actorType, ["user", "ai", "system"])),
    index("trail_events_entity_idx").on(t.entityId, t.at.desc()),
    index("trail_events_at_idx").on(t.at.desc()),
    index("trail_events_actor_idx").on(t.actorId, t.at.desc()),
  ],
)

/**
 * The sealed HMAC key of the trail chain: one row, created by the migration and filled on first
 * write. Entries with seq <= legacyThrough predate the key and were chained with unkeyed SHA-256.
 */
export const trailKey = pgTable(
  "trail_key",
  {
    id: integer("id").primaryKey(),
    keyCiphertext: text("key_ciphertext"),
    keyNonce: text("key_nonce"),
    legacyThrough: bigint("legacy_through", { mode: "number" }).notNull(),
  },
  (t) => [check("trail_key_singleton_check", sql`${t.id} = 1`)],
)

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    actorId: uuid("actor_id").notNull(),
    command: text("command").notNull(),
    result: jsonb("result").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.key] }),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ],
)
