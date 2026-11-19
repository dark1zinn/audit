/**
 * Account creation shared by first-run setup and invite acceptance. Writes the Better Auth user and
 * credential rows directly, so the account, its membership and its grants commit together.
 */
import { account, entities, user, userProfiles, workspaceMembers } from "@audit/db/schema"
import { Conflict } from "@audit/domain/errors"
import type { UserId } from "@audit/domain/ids"
import type { Locale } from "@audit/domain/identity/schema"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Db } from "@audit/platform/database"
import { Effect } from "effect"
import { isUniqueViolation } from "../command.ts"
import { emit, record } from "../trail.ts"

export interface NewAccount {
  readonly name: string
  readonly email: string
  readonly password: string
  readonly role: WorkspaceRole
  readonly invitedBy: UserId | null
  readonly locale?: Locale
  readonly timezone?: string
}

export const hashPassword = (password: string) =>
  Effect.promise(() => Bun.password.hash(password, { algorithm: "argon2id" }))

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const createAccount = (input: NewAccount) =>
  Effect.gen(function* () {
    const db = yield* Db
    const email = normalizeEmail(input.email)
    const userId = Bun.randomUUIDv7() as UserId
    const passwordHash = yield* hashPassword(input.password)

    yield* db
      .insert(user)
      .values({ id: userId, name: input.name, email, emailVerified: true })
      .pipe(
        Effect.catchIf(isUniqueViolation, () =>
          Effect.fail(new Conflict({ message: "An account with this email already exists" })),
        ),
      )
    yield* db.insert(account).values({
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    })
    yield* db.insert(entities).values({ id: userId, type: "user", title: input.name })
    yield* db.insert(userProfiles).values({
      userId,
      displayName: input.name,
      timezone: input.timezone ?? "UTC",
      locale: input.locale ?? null,
    })
    yield* db
      .insert(workspaceMembers)
      .values({ userId, role: input.role, invitedBy: input.invitedBy })

    yield* record({
      action: "member.joined",
      entityId: userId,
      entityType: "user",
      details: { email, role: input.role },
    })
    yield* emit({
      _tag: "MembersChanged",
      userId,
      entityId: userId,
      projectId: null,
      actorId: input.invitedBy,
      version: null,
    })
    return userId
  })
