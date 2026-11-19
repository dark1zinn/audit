import type { Authz } from "@audit/core/authz"
import { icalFeed } from "@audit/core/calendar/queries"
import type { EventBus } from "@audit/core/event-bus"
import { CurrentActor } from "@audit/domain/actor"
import type { Db } from "@audit/platform/database"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import type { SqlClient } from "effect/sql"

/**
 * Personal calendar feed. The token in the path is the only credential, so the route runs as a
 * system actor and `icalFeed` resolves the owner from the token's hash.
 */
const icalRoute = (core: Context.Context<Db | SqlClient.SqlClient | Authz | EventBus>) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const file = params["file"] ?? ""
    if (!file.endsWith(".ics")) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const body = yield* icalFeed.execute({ token: file.slice(0, -".ics".length) }).pipe(
      Effect.provideService(CurrentActor, { _tag: "system", reason: "ical-feed" } as const),
      Effect.provide(core),
      Effect.catchTag("NotFound", () => Effect.succeed(null)),
    )
    if (body === null) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    return HttpServerResponse.text(body, { contentType: "text/calendar; charset=utf-8" })
  })

export const IcalHttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const core = yield* Effect.context<Db | SqlClient.SqlClient | Authz | EventBus>()
    return HttpRouter.add("GET", "/ical/:file", icalRoute(core))
  }),
)
