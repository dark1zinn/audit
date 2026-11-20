/**
 * Self sign-up. The workspace sign-up policy decides who may ask. With mail, a valid request
 * invites that exact address: the invite link is mailed and the applicant chooses a password on
 * the join page. Without mail, the request waits for an admin, who approves it into an invite link
 * or rejects it. The answer never depends on whether the address already has an account.
 */
import { invites, signupRequests, user, workspace } from "@audit/db/schema"
import { Forbidden, NotFound } from "@audit/domain/errors"
import { ApprovedSignup, SignedUp, SignupInput } from "@audit/domain/admin/schema"
import {
  defaultWorkspaceSettings,
  type SignupPolicy,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import { Uuid } from "@audit/domain/ids"
import { AppConfig } from "@audit/platform/config"
import { generateToken, sha256Hex } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { Jobs } from "@audit/platform/jobs"
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { createInvite } from "../identity/commands.ts"
import { normalizeEmail } from "../identity/accounts.ts"
import { inviteMailJob } from "../notifications/account-mail.ts"
import { Mailer } from "../notifications/mail.ts"
import { record } from "../trail.ts"
import { requireSettings } from "./commands.ts"

/** Same expiry as an invite made by an admin. */
const INVITE_DAYS = 7
/** How long a request waits for an admin when no mail is configured. */
const REQUEST_DAYS = 14
const DAY_MS = 24 * 3_600_000

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
      const db = yield* Db
      const mailer = yield* Mailer
      const config = yield* AppConfig
      const email = normalizeEmail(input.email)
      const name = input.name === undefined || input.name === "" ? null : input.name
      const delivery = mailer.enabled ? "email" : "approval"
      const [existing] = yield* db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
        .pipe(Effect.orDie)
      if (existing !== undefined) return { delivery }
      if (mailer.enabled) {
        // A newer request replaces an older unused invite for the same address.
        yield* db
          .update(invites)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invites.email, email),
              isNull(invites.createdBy),
              isNull(invites.revokedAt),
              eq(invites.useCount, 0),
            ),
          )
          .pipe(Effect.orDie)
        const token = generateToken()
        yield* db
          .insert(invites)
          .values({
            tokenHash: sha256Hex(token),
            email,
            role: "member",
            expiresAt: new Date(Date.now() + INVITE_DAYS * DAY_MS),
            maxUses: 1,
            createdBy: null,
            note: null,
          })
          .pipe(Effect.orDie)
        const jobs = yield* Jobs
        yield* jobs.enqueue(inviteMailJob, {
          email,
          url: new URL(`/join/${token}`, config.url).toString(),
        })
      } else {
        const expiresAt = new Date(Date.now() + REQUEST_DAYS * DAY_MS)
        yield* db
          .insert(signupRequests)
          .values({ email, name, expiresAt })
          .onConflictDoUpdate({
            target: signupRequests.email,
            set: { name, expiresAt, createdAt: new Date() },
          })
          .pipe(Effect.orDie)
      }
      yield* record({ action: "member.signup_requested", details: { delivery } })
      return { delivery }
    }),
})

/** Requests waiting for an admin, oldest first. Only requests made without mail exist here. */
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
    .where(gt(signupRequests.expiresAt, sql`now()`))
    .orderBy(asc(signupRequests.createdAt))
    .pipe(Effect.orDie)
})

/** Turns a pending request into an invite bound to its address; the admin copies the link. */
export const approveSignup = Command.make("signup.approve", {
  input: Schema.Struct({ id: Uuid }),
  output: ApprovedSignup,
  authorize: () => requireSettings(),
  run: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [request] = yield* db
        .delete(signupRequests)
        .where(and(eq(signupRequests.id, id), gt(signupRequests.expiresAt, sql`now()`)))
        .returning()
        .pipe(Effect.orDie)
      if (request === undefined) return yield* Effect.fail(new NotFound({ entity: "signup", id }))
      const { url } = yield* createInvite.execute({ email: request.email, role: "member" })
      yield* record({ action: "signup.approve" })
      return { url }
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
        .where(eq(signupRequests.id, id))
        .returning({ id: signupRequests.id })
        .pipe(Effect.orDie)
      if (removed.length === 0) return yield* Effect.fail(new NotFound({ entity: "signup", id }))
      yield* record({ action: "signup.reject" })
    }),
})
