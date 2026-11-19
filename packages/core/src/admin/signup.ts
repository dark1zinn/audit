/**
 * Self sign-up. The workspace sign-up policy decides who may create an account: `closed` (the
 * default) refuses everyone, `domains` admits only emails on the allowlisted domains.
 */
import { workspace } from "@audit/db/schema"
import { Forbidden } from "@audit/domain/errors"
import {
  defaultWorkspaceSettings,
  type SignupPolicy,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import { SignedUp, SignupInput } from "@audit/domain/admin/schema"
import { Db } from "@audit/platform/database"
import { Effect } from "effect"
import * as Command from "../command.ts"
import { assertNotBreached } from "./passwords.ts"
import { createAccount, normalizeEmail } from "../identity/accounts.ts"
import { record } from "../trail.ts"

const loadWorkspace = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db
    .select({ settings: workspace.settings, signupPolicy: workspace.signupPolicy })
    .from(workspace)
    .pipe(Effect.orDie)
  const settings: WorkspaceSettings = {
    ...defaultWorkspaceSettings,
    ...(row?.settings as Partial<WorkspaceSettings> | undefined),
  }
  return { settings, policy: row?.signupPolicy as SignupPolicy }
})

export const signup = Command.make("member.signup", {
  input: SignupInput,
  output: SignedUp,
  authorize: (input) =>
    Effect.gen(function* () {
      const { policy } = yield* loadWorkspace
      const closed = new Forbidden({
        action: "member.signup",
        message: "Sign-up is closed for this workspace",
      })
      if (policy.mode === "closed") return yield* closed
      const domain = normalizeEmail(input.email).split("@")[1] ?? ""
      const allowed = policy.domains.map((entry) => entry.trim().toLowerCase())
      if (!allowed.includes(domain)) return yield* closed
    }),
  run: (input) =>
    Effect.gen(function* () {
      const { settings } = yield* loadWorkspace
      yield* assertNotBreached(input.password, settings.breachedPasswordCheck === true)
      const userId = yield* createAccount({
        name: input.name,
        email: input.email,
        password: input.password,
        role: "member",
        invitedBy: null,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      })
      yield* record({ action: "member.signed_up", entityId: userId, entityType: "user" })
      return { userId }
    }),
})
