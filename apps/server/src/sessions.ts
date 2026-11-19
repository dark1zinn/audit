/**
 * Turns a Better Auth session cookie into the `CurrentActor`, enforcing membership, deactivation,
 * the idle timeout and the workspace 2FA policy.
 */
import {
  session as sessionTable,
  user,
  userProfiles,
  workspace,
  workspaceMembers,
} from "@audit/db/schema"
import type { Actor } from "@audit/domain/actor"
import { Unauthorized } from "@audit/domain/errors"
import { defaultWorkspaceSettings, type WorkspaceSettings } from "@audit/domain/identity/schema"
import type { UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { AuthHandle } from "./auth.ts"

export interface ResolvedSession {
  readonly actor: Extract<Actor, { _tag: "user" }>
  /** The workspace requires 2FA for this person and they have not enrolled yet. */
  readonly twoFactorRequired: boolean
}

export interface SessionsShape {
  readonly resolve: (headers: Headers) => Effect.Effect<ResolvedSession, Unauthorized>
  /** Whether a user may be given a session at all. */
  readonly canSignIn: (userId: UserId) => Effect.Effect<boolean>
}

export class Sessions extends Context.Service<Sessions, SessionsShape>()(
  "@audit/server/Sessions",
) {}

const DAY_MS = 86_400_000

export const sessionsLayer = (auth: AuthHandle) =>
  Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const db = yield* Db

      const member = (userId: UserId) =>
        db
          .select({
            role: workspaceMembers.role,
            deactivatedAt: userProfiles.deactivatedAt,
            twoFactorEnabled: user.twoFactorEnabled,
          })
          .from(workspaceMembers)
          .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
          .innerJoin(user, eq(user.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.userId, userId))
          .pipe(
            Effect.map((rows) => rows[0]),
            Effect.orDie,
          )

      const settings = db
        .select({ settings: workspace.settings })
        .from(workspace)
        .pipe(
          Effect.map((rows): WorkspaceSettings => ({
            ...defaultWorkspaceSettings,
            ...(rows[0]?.settings as Partial<WorkspaceSettings> | undefined),
          })),
          Effect.orDie,
        )

      const unauthorized = (message: string) => Effect.fail(new Unauthorized({ message }))

      return Sessions.of({
        canSignIn: (userId) =>
          Effect.map(member(userId), (row) => row !== undefined && row.deactivatedAt === null),
        resolve: (headers) =>
          Effect.gen(function* () {
            const found = yield* Effect.promise(() => auth.getSession(headers))
            if (found === null) return yield* unauthorized("Not signed in")
            const userId = found.user.id as UserId
            const row = yield* member(userId)
            if (row === undefined || row.deactivatedAt !== null) {
              return yield* unauthorized("This account is not active in the workspace")
            }
            const policy = yield* settings
            // Better Auth extends a session when it refreshes `updatedAt` (at most daily), so both the
            // rolling lifetime and the idle timeout count from that refresh; the shorter one applies.
            const lifetimeDays = Math.min(policy.sessionDays, policy.idleDays)
            if (Date.now() - found.session.updatedAt.getTime() > lifetimeDays * DAY_MS) {
              yield* db
                .delete(sessionTable)
                .where(eq(sessionTable.id, found.session.id))
                .pipe(Effect.orDie)
              return yield* unauthorized("The session expired after inactivity")
            }
            const needsTwoFactor =
              policy.twoFactorPolicy === "everyone" ||
              (policy.twoFactorPolicy === "admins" &&
                (row.role === "owner" || row.role === "admin"))
            return {
              actor: { _tag: "user", userId, role: row.role },
              twoFactorRequired: needsTwoFactor && row.twoFactorEnabled !== true,
            } satisfies ResolvedSession
          }),
      })
    }),
  )
