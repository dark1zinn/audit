import { Context, Schema } from "effect"
import { UserId } from "./ids.ts"
import { WorkspaceRole } from "./roles.ts"

/** A signed-in person acting for themselves. */
export const UserActor = Schema.TaggedStruct("user", {
  userId: UserId,
  role: WorkspaceRole,
})
export type UserActor = typeof UserActor.Type

/** The AI acting on behalf of a person, with that person's permissions. */
export const AiActor = Schema.TaggedStruct("ai", {
  onBehalfOf: UserId,
  role: WorkspaceRole,
})
export type AiActor = typeof AiActor.Type

/** The server itself: jobs, setup, migrations. */
export const SystemActor = Schema.TaggedStruct("system", {
  reason: Schema.String,
})
export type SystemActor = typeof SystemActor.Type

export const Actor = Schema.Union([UserActor, AiActor, SystemActor])
export type Actor = typeof Actor.Type

/** Who is acting in the current request, job or AI tool call. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "@audit/domain/CurrentActor",
) {}

/** The user whose permissions apply, or `null` for the system. */
export const actorUserId = (actor: Actor): UserId | null => {
  switch (actor._tag) {
    case "user":
      return actor.userId
    case "ai":
      return actor.onBehalfOf
    case "system":
      return null
  }
}
