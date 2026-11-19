/**
 * Fixtures built through the real commands where they exist, so tests exercise the same paths as
 * the server.
 */
import * as identity from "@audit/core/identity/commands"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type { UserId } from "@audit/domain/ids"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Effect } from "effect"
import type { TestDatabase, TestServices } from "./database.ts"

export const system: Actor = { _tag: "system", reason: "test" }

export const userActor = (userId: UserId, role: WorkspaceRole): Actor => ({
  _tag: "user",
  userId,
  role,
})

/** Runs an effect as `actor`, failing the test on any error. */
export const runAs =
  (database: TestDatabase, actor: Actor) =>
  <A, E>(effect: Effect.Effect<A, E, TestServices | CurrentActor>): Promise<A> =>
    database.runtime.runPromise(effect.pipe(Effect.provideService(CurrentActor, actor)))

/** Runs an effect as `actor` and returns its exit, for asserting failures. */
export const exitAs =
  (database: TestDatabase, actor: Actor) =>
  <A, E>(effect: Effect.Effect<A, E, TestServices | CurrentActor>) =>
    database.runtime.runPromise(
      effect.pipe(Effect.provideService(CurrentActor, actor), Effect.exit),
    )

export const PASSWORD = "correct horse battery staple"

export interface Person {
  readonly userId: UserId
  readonly email: string
  readonly role: WorkspaceRole
  readonly actor: Actor
}

/** Creates the workspace and its owner. */
export const setupWorkspace = async (database: TestDatabase): Promise<Person> => {
  const email = "owner@example.test"
  const userId = await runAs(
    database,
    system,
  )(
    identity.completeSetup.execute({
      token: "unused",
      workspaceName: "Test workspace",
      name: "Owner",
      email,
      password: PASSWORD,
    }),
  )
  return { userId, email, role: "owner", actor: userActor(userId, "owner") }
}

/** Adds a person through an invite created by `inviter`, then promotes them when needed. */
export const addPerson = async (
  database: TestDatabase,
  inviter: Person,
  name: string,
  role: WorkspaceRole,
): Promise<Person> => {
  const email = `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, ".")}@example.test`
  const created = await runAs(
    database,
    inviter.actor,
  )(identity.createInvite.execute({ role: role === "guest" ? "guest" : "member" }))
  const token = created.url.split("/join/")[1]!
  const userId = await runAs(
    database,
    system,
  )(identity.acceptInvite.execute({ token, name, email, password: PASSWORD }))
  if (role === "admin") {
    await runAs(database, inviter.actor)(identity.changeRole.execute({ userId, role: "admin" }))
  }
  return { userId, email, role, actor: userActor(userId, role) }
}
