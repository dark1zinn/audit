/**
 * Host-side commands behind `audit create-owner`, `audit reset-password`, `audit reindex`, and
 * `audit reembed`. Whoever can run the binary already controls the database, so these run as the
 * system actor and skip sign-in. Every change is still a named command with its own trail entry.
 */
import { reembedAll } from "@audit/core/ai/reembed"
import { Authz } from "@audit/core/authz"
import * as Command from "@audit/core/command"
import { createAccount, normalizeEmail } from "@audit/core/identity/accounts"
import * as identity from "@audit/core/identity/commands"
import { resetIdentifier } from "@audit/core/identity/reset-token"
import { reindexSearch } from "@audit/core/search/reindex"
import { record } from "@audit/core/trail"
import type { UserId } from "@audit/domain/ids"
import { PasswordResetLink } from "@audit/domain/identity/schema"
import { user, verification, workspace, workspaceMembers } from "@audit/db/schema"
import { generateToken } from "@audit/platform/crypto"
import { AppConfig } from "@audit/platform/config"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

const RESET_LINK_HOURS = 24

/** A password nobody knows: the owner sets their own through the one-time link. */
const unknownPassword = () => generateToken(24)

/** Issues a one-time reset link for any account, owners included (the host controls the box). */
const issueResetLink = Command.make("member.password_reset_link_created", {
  input: Schema.String,
  output: PasswordResetLink,
  authorize: () => Effect.void,
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const config = yield* AppConfig
      const token = generateToken(24)
      const expiresAt = new Date(Date.now() + RESET_LINK_HOURS * 3_600_000)
      yield* db
        .insert(verification)
        .values({ identifier: resetIdentifier(token), value: userId, expiresAt })
      yield* record({
        action: "member.password_reset_link_created",
        entityId: userId as UserId,
        entityType: "user",
        details: { via: "cli" },
      })
      return { url: new URL(`/reset-password?token=${token}`, config.url).toString(), expiresAt }
    }),
})

/** New owner account for an email with no account yet. */
const createOwnerAccount = Command.make("operator.owner_created", {
  input: Schema.Struct({ name: Schema.String, email: Schema.String, password: Schema.String }),
  output: Schema.String,
  authorize: () => Effect.void,
  run: (input) =>
    createAccount({ ...input, role: "owner", invitedBy: null }).pipe(
      Effect.map((userId) => userId as string),
    ),
})

/** Gives an existing member the owner role; sessions and password stay as they are. */
const promoteToOwner = Command.make("member.role_changed", {
  input: Schema.String,
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const [member] = yield* db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId as UserId))
      if (member === undefined || member.role === "owner") return
      yield* db
        .update(workspaceMembers)
        .set({ role: "owner" })
        .where(eq(workspaceMembers.userId, userId as UserId))
      yield* authz.rebuild({ userId: userId as UserId })
      yield* record({
        action: "member.role_changed",
        entityId: userId as UserId,
        entityType: "user",
        diff: { role: [member.role, "owner"] },
        details: { via: "cli" },
      })
    }),
})

const accountByEmail = (email: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.email, normalizeEmail(email)))
    return row
  })

export type OwnerStatus = "setup" | "created" | "promoted" | "unchanged"

export interface OwnerResult {
  readonly status: OwnerStatus
  readonly email: string
  readonly url: string
  readonly expiresAt: Date
}

/**
 * Recovery path for a lost owner. With no workspace it runs setup; otherwise it creates an owner
 * for an unknown email, or promotes the existing member, and returns a one-time password link.
 */
export const createOwner = (input: {
  readonly email: string
  readonly name: string
  readonly workspaceName: string
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const email = normalizeEmail(input.email)
    const [existing] = yield* db.select({ id: workspace.id }).from(workspace).limit(1)
    let userId: string
    let status: OwnerStatus
    if (existing === undefined) {
      userId = yield* identity.completeSetup.executeUnknown({
        token: "cli",
        workspaceName: input.workspaceName,
        name: input.name,
        email,
        password: unknownPassword(),
      })
      status = "setup"
    } else {
      const account = yield* accountByEmail(email)
      if (account === undefined) {
        userId = yield* createOwnerAccount.execute({
          name: input.name,
          email,
          password: unknownPassword(),
        })
        status = "created"
      } else {
        userId = account.id
        const [member] = yield* db
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.userId, account.id as UserId))
        status = member?.role === "owner" ? "unchanged" : "promoted"
        // Reactivating an active member is a no-op, so a deactivated owner-to-be comes back too.
        yield* identity.reactivateMember.execute(account.id as UserId)
        yield* promoteToOwner.execute(account.id)
      }
    }
    const link = yield* issueResetLink.execute(userId)
    return { status, email, url: link.url, expiresAt: link.expiresAt } satisfies OwnerResult
  })

/** One-time password link for an existing account; null when no account has that email. */
export const resetPassword = (email: string) =>
  Effect.gen(function* () {
    const account = yield* accountByEmail(email)
    if (account === undefined) return null
    const link = yield* issueResetLink.execute(account.id)
    return { email: account.email, url: link.url, expiresAt: link.expiresAt }
  })

/** Recomputes search text for every indexed entity. */
export const reindex = reindexSearch.execute({})

/** Drops every embedding and queues re-sync jobs; the running server processes the queue. */
export const reembed = reembedAll.execute({})
