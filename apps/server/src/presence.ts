/**
 * Who is looking at a scope right now. Presence lives only in memory on this process: it is never
 * stored, audited or sent to anyone outside the scope. Joins are refcounted per user, so a second
 * open tab does not remove the viewer when the first one closes. Focus updates are throttled to one
 * per second per user; `update` reports whether the update was accepted.
 */
import { Authz } from "@audit/core/authz"
import { projects, userProfiles } from "@audit/db/schema"
import { CurrentActor, actorUserId } from "@audit/domain/actor"
import { Unauthorized } from "@audit/domain/errors"
import type { PresenceState } from "@audit/domain/events"
import type { EntityId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, PubSub, Stream } from "effect"

const THROTTLE_MS = 1000
const TYPING_TTL_MS = 5000

interface Entry {
  readonly name: string
  focusEntityId: EntityId | null
  /** Epoch ms until which the viewer counts as typing; 0 when not typing. */
  typingUntil: number
  refs: number
}

export interface PresenceShape {
  readonly join: (scope: string) => Stream.Stream<PresenceState, Unauthorized, CurrentActor>
  readonly update: (input: {
    readonly scope: string
    readonly focusEntityId: EntityId | null
    readonly typing?: boolean
  }) => Effect.Effect<{ readonly accepted: boolean }, Unauthorized, CurrentActor>
}

export class Presence extends Context.Service<Presence, PresenceShape>()("@audit/server/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const authz = yield* Authz
      const db = yield* Db
      const changes = yield* Effect.acquireRelease(
        PubSub.unbounded<PresenceState>(),
        PubSub.shutdown,
      )
      const scopes = new Map<string, Map<UserId, Entry>>()
      const lastUpdate = new Map<UserId, number>()

      const snapshot = (scope: string): PresenceState => ({
        _tag: "Presence",
        scope,
        viewers: [...(scopes.get(scope) ?? new Map<UserId, Entry>())].map(([userId, entry]) => ({
          userId,
          name: entry.name,
          focusEntityId: entry.focusEntityId,
          typing: entry.typingUntil > Date.now(),
        })),
      })

      const authorize = (scope: string) =>
        Effect.gen(function* () {
          const denied = new Unauthorized({ message: "No access to this scope" })
          if (scope === "workspace") return
          if (scope.startsWith("project:")) {
            const key = scope.slice("project:".length)
            const [row] = yield* db
              .select({ id: projects.id })
              .from(projects)
              .where(eq(projects.key, key))
              .pipe(Effect.orDie)
            if (row === undefined || !(yield* authz.can("project.read", row.id as EntityId))) {
              return yield* denied
            }
            return
          }
          if (scope.startsWith("entity:") || scope.startsWith("channel:")) {
            const id = scope.slice(scope.indexOf(":") + 1) as EntityId
            if (!(yield* authz.can("entity.read", id))) return yield* denied
            return
          }
          return yield* denied
        })

      const displayName = (userId: UserId) =>
        db
          .select({ name: userProfiles.displayName })
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .pipe(
            Effect.map((rows) => rows[0]?.name ?? ""),
            Effect.orDie,
          )

      const leave = (scope: string, userId: UserId) =>
        Effect.gen(function* () {
          const members = scopes.get(scope)
          const entry = members?.get(userId)
          if (members === undefined || entry === undefined) return
          entry.refs -= 1
          if (entry.refs > 0) return
          members.delete(userId)
          if (members.size === 0) scopes.delete(scope)
          yield* PubSub.publish(changes, snapshot(scope))
        })

      // Focus names an entity, so each recipient sees it only when they can read that entity.
      const maskFocus = (state: PresenceState) =>
        Effect.forEach(state.viewers, (viewer) =>
          Effect.gen(function* () {
            if (viewer.focusEntityId === null) return viewer
            const canSee = yield* authz.can("entity.read", viewer.focusEntityId)
            return canSee ? viewer : { ...viewer, focusEntityId: null }
          }),
        ).pipe(Effect.map((viewers) => ({ ...state, viewers })))

      return Presence.of({
        join: (scope) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const userId = actorUserId(yield* CurrentActor)
              if (userId === null) return yield* new Unauthorized({ message: "Not signed in" })
              yield* authorize(scope)
              const name = yield* displayName(userId)

              const members = scopes.get(scope) ?? new Map<UserId, Entry>()
              scopes.set(scope, members)
              const existing = members.get(userId)
              if (existing === undefined) {
                members.set(userId, { name, focusEntityId: null, refs: 1, typingUntil: 0 })
              } else {
                existing.refs += 1
              }

              // Subscribe before publishing so this stream receives its own change too.
              const queue = yield* PubSub.subscribe(changes)
              const initial = snapshot(scope)
              yield* PubSub.publish(changes, initial)
              return Stream.concat(
                Stream.make(initial),
                Stream.fromSubscription(queue).pipe(
                  Stream.filter((state) => state.scope === scope),
                ),
              ).pipe(
                Stream.mapEffect(maskFocus),
                Stream.onExit(() => leave(scope, userId)),
              )
            }),
          ),

        update: ({ scope, focusEntityId, typing }) =>
          Effect.gen(function* () {
            const userId = actorUserId(yield* CurrentActor)
            if (userId === null) return yield* new Unauthorized({ message: "Not signed in" })
            const entry = scopes.get(scope)?.get(userId)
            if (entry === undefined) return { accepted: false }
            const now = Date.now()
            // Stopping typing always goes through; everything else obeys the throttle.
            const stopsTyping = typing === false && entry.typingUntil > now
            if (!stopsTyping && now - (lastUpdate.get(userId) ?? 0) < THROTTLE_MS) {
              return { accepted: false }
            }
            lastUpdate.set(userId, now)
            let changed = entry.focusEntityId !== focusEntityId
            entry.focusEntityId = focusEntityId
            if (typing === true) {
              if (entry.typingUntil <= now) changed = true
              const until = now + TYPING_TTL_MS
              entry.typingUntil = until
              // Clears itself unless a later refresh moved `typingUntil` on.
              yield* Effect.forkDetach(
                Effect.gen(function* () {
                  yield* Effect.sleep(TYPING_TTL_MS)
                  if (entry.typingUntil !== until || scopes.get(scope)?.get(userId) !== entry) {
                    return
                  }
                  entry.typingUntil = 0
                  yield* PubSub.publish(changes, snapshot(scope))
                }),
              )
            } else if (typing === false && entry.typingUntil > 0) {
              entry.typingUntil = 0
              changed = true
            }
            if (changed) yield* PubSub.publish(changes, snapshot(scope))
            return { accepted: true }
          }),
      })
    }),
  )
}
