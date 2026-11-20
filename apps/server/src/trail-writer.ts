/**
 * Writes audit entries from outside the command layer: Better Auth's sign-in and security hooks.
 */
import { CurrentActor } from "@audit/domain/actor"
import type { UserId } from "@audit/domain/ids"
import { Authz } from "@audit/core/authz"
import { RequestMeta } from "@audit/core/request"
import { writeTrail } from "@audit/core/trail"
import type { Db } from "@audit/platform/database"
import type { Secrets } from "@audit/platform/crypto"
import type { SqlClient } from "effect/sql"
import { Effect, type ManagedRuntime } from "effect"

export interface TrailWriterEntry {
  /** `null` records the server as actor (e.g. a failed sign-in for an unknown account). */
  readonly actor: { readonly userId: string } | null
  readonly action: string
  readonly entityId?: string
  readonly entityType?: string
  readonly meta?: {
    readonly ip?: string
    readonly userAgent?: string
    readonly details?: Record<string, unknown>
  }
}

export type TrailWriter = (entry: TrailWriterEntry) => Promise<void>

export const makeTrailWriter =
  (
    runtime: ManagedRuntime.ManagedRuntime<Db | Authz | Secrets | SqlClient.SqlClient, unknown>,
  ): TrailWriter =>
  (entry) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const authz = yield* Authz
        const userId = entry.actor?.userId as UserId | undefined
        const role = userId === undefined ? null : yield* authz.workspaceRole(userId)
        const { details, ...request } = entry.meta ?? {}
        yield* writeTrail({
          action: entry.action,
          entityId: (entry.entityId as UserId | undefined) ?? null,
          entityType: entry.entityType ?? null,
          ...(details === undefined ? {} : { details }),
        }).pipe(
          Effect.provideService(
            CurrentActor,
            userId === undefined
              ? { _tag: "system", reason: "auth" }
              : { _tag: "user", userId, role: role ?? "guest" },
          ),
          Effect.provideService(RequestMeta, request),
        )
      }),
    )
