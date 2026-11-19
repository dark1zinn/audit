import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden } from "@audit/domain/errors"
import type { UserId } from "@audit/domain/ids"
import { Effect } from "effect"

/** The signed-in person performing a write. API keys and system jobs are not people. */
export const currentUser = (action: string): Effect.Effect<UserId, Forbidden, CurrentActor> =>
  Effect.gen(function* () {
    const userId = actorUserId(yield* CurrentActor)
    if (userId === null) return yield* new Forbidden({ action, message: "Only people can do this" })
    return userId
  })
