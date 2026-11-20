/**
 * Self sign-up. The workspace sign-up policy decides who may ask: `closed` (the default) refuses
 * everyone, `domains` admits only emails on the allowlisted domains.
 *
 * A request never creates an account by itself. With mail configured, the applicant opens the
 * single-use link (valid 24 h) and the account is created then. Without mail, an admin approves or
 * rejects the request. The answer never shows whether the address already has an account.
 */
import { signupRequests, user, workspace } from "@audit/db/schema"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { SignedUp, SignupInput, VerifySignupInput } from "@audit/domain/admin/schema"
import {
  defaultWorkspaceSettings,
  type SignupPolicy,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import { Uuid } from "@audit/domain/ids"
import { AppConfig } from "@audit/platform/config"
import { generateToken, sha256Hex } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import {
  createAccount,
  hashPassword,
  type NewAccount,
  normalizeEmail,
} from "../identity/accounts.ts"
import { sendSignupVerificationEmail } from "../notifications/account-mail.ts"
import { Mailer } from "../notifications/mail.ts"
import { record } from "../trail.ts"
import { assertNotBreached } from "./passwords.ts"
import { requireSettings } from "./commands.ts"

const SIGNUP_LINK_HOURS = 24

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

const invalidLink = new ValidationError({
  message: "This sign-up link is invalid or has expired",
  field: "token",
})

/** Opens the account for a request; the password was hashed when the request was made. */
const openAccount = (request: typeof signupRequests.$inferSelect) =>
  createAccount({
    name: request.name,
    email: request.email,
    passwordHash: request.passwordHash,
    role: "member",
    invitedBy: null,
    ...(request.locale === null
      ? {}
      : { locale: request.locale as NonNullable<NewAccount["locale"]> }),
    timezone: request.timezone,
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
      const db = yield* Db
      const mailer = yield* Mailer
      const config = yield* AppConfig
      const { settings } = yield* loadWorkspace
      yield* assertNotBreached(input.password, settings.breachedPasswordCheck === true)
      const email = normalizeEmail(input.email)
      const delivery = mailer.enabled ? "email" : "approval"
      // Hashed on every request, known address or not, so the timing reveals nothing either.
      const passwordHash = yield* hashPassword(input.password)
      const [existing] = yield* db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
        .pipe(Effect.orDie)
      if (existing !== undefined) return { delivery }
      // An expired link gives way to a new request; a live one stays, so nobody can replace it.
      yield* db
        .delete(signupRequests)
        .where(and(eq(signupRequests.email, email), lt(signupRequests.expiresAt, sql`now()`)))
        .pipe(Effect.orDie)
      const token = mailer.enabled ? generateToken() : null
      const [request] = yield* db
        .insert(signupRequests)
        .values({
          email,
          name: input.name,
          passwordHash,
          locale: input.locale ?? null,
          timezone: input.timezone ?? "UTC",
          tokenHash: token === null ? null : sha256Hex(token),
          expiresAt: token === null ? null : new Date(Date.now() + SIGNUP_LINK_HOURS * 3_600_000),
        })
        .onConflictDoNothing({ target: signupRequests.email })
        .returning({ id: signupRequests.id })
        .pipe(Effect.orDie)
      if (request === undefined) return { delivery }
      yield* record({ action: "member.signup_requested", details: { delivery } })
      if (token !== null) {
        yield* sendSignupVerificationEmail({
          email,
          url: new URL(`/signup?verify=${encodeURIComponent(token)}`, config.url).toString(),
        })
      }
      return { delivery }
    }),
})

/** Opens the account behind an emailed link. The link is single-use: it is consumed here. */
export const verifySignup = Command.make("member.signup_verified", {
  input: VerifySignupInput,
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ token }) =>
    Effect.gen(function* () {
      const db = yield* Db
      // Delete and return in one statement, so a link opens at most one account even if clicked twice.
      const [request] = yield* db
        .delete(signupRequests)
        .where(
          and(
            eq(signupRequests.tokenHash, sha256Hex(token)),
            gt(signupRequests.expiresAt, sql`now()`),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      if (request === undefined) return yield* Effect.fail(invalidLink)
      const userId = yield* openAccount(request)
      yield* record({ action: "member.signed_up", entityId: userId, entityType: "user" })
    }),
})

/** Requests waiting for an admin, oldest first. Only requests made without mail have no link. */
export const pendingSignups = Effect.gen(function* () {
  yield* requireSettings()
  const db = yield* Db
  return yield* db
    .select({
      id: signupRequests.id,
      name: signupRequests.name,
      email: signupRequests.email,
      requestedAt: signupRequests.createdAt,
    })
    .from(signupRequests)
    .where(isNull(signupRequests.tokenHash))
    .orderBy(asc(signupRequests.createdAt))
    .pipe(Effect.orDie)
})

export const approveSignup = Command.make("signup.approve", {
  input: Schema.Struct({ id: Uuid }),
  output: Schema.Void,
  authorize: () => requireSettings(),
  run: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [request] = yield* db
        .delete(signupRequests)
        .where(and(eq(signupRequests.id, id), isNull(signupRequests.tokenHash)))
        .returning()
        .pipe(Effect.orDie)
      if (request === undefined) return yield* Effect.fail(new NotFound({ entity: "signup", id }))
      const userId = yield* openAccount(request)
      yield* record({ action: "signup.approve", entityId: userId, entityType: "user" })
    }),
})

export const rejectSignup = Command.make("signup.reject", {
  input: Schema.Struct({ id: Uuid }),
  output: Schema.Void,
  authorize: () => requireSettings(),
  run: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const removed = yield* db
        .delete(signupRequests)
        .where(and(eq(signupRequests.id, id), isNull(signupRequests.tokenHash)))
        .returning({ id: signupRequests.id })
        .pipe(Effect.orDie)
      if (removed.length === 0) return yield* Effect.fail(new NotFound({ entity: "signup", id }))
      yield* record({ action: "signup.reject" })
    }),
})
