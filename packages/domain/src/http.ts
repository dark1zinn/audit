import { HttpApiMiddleware } from "effect/http-api"
import { RpcMiddleware } from "effect/rpc"
import { CurrentActor } from "./actor.ts"
import { Unauthorized } from "./errors.ts"

/** Resolves the Better Auth session cookie into the `CurrentActor` for every protected endpoint. */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentActor }
>()("@audit/domain/Authentication", { error: Unauthorized }) {}

/** Resolves the session cookie sent with the `/rpc` WebSocket upgrade into the `CurrentActor`. */
export class RpcAuthentication extends RpcMiddleware.Service<
  RpcAuthentication,
  { provides: CurrentActor }
>()("@audit/domain/RpcAuthentication", { error: Unauthorized }) {}
