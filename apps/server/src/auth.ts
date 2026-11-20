/**
 * Better Auth handles credentials and sessions; audit owns membership, so sessions are only
 * created for active members, and sign-ins, failures and 2FA changes are written to the trail.
 */
import * as authSchema from "@audit/db/auth-schema"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { twoFactor } from "better-auth/plugins"
import { defineRelations } from "drizzle-orm"
import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import type { AppConfigShape } from "@audit/platform/config"
import { sha256Hex } from "@audit/platform/crypto"
import { RESET_IDENTIFIER_PREFIX, resetIdentifier } from "@audit/core/identity/reset-token"
import { Redacted } from "effect"
import { CLIENT_IP_HEADER } from "./client-ip.ts"
import { makeSignInLockout } from "./signin-lockout.ts"
import { makeResetRequestLimit } from "./reset-request-limit.ts"
import type { TrailWriter } from "./trail-writer.ts"

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

/**
 * Reset rows are stored under the hash of their token (see resetIdentifier), so the token Better
 * Auth receives is hashed here before it looks the row up.
 */
const hashResetToken = (ctx: { readonly body?: unknown; readonly query?: unknown }) => {
  const body = recordOf(ctx.body)
  if (typeof body.token === "string") {
    return { context: { body: { ...body, token: sha256Hex(body.token) } } }
  }
  const query = recordOf(ctx.query)
  if (typeof query.token === "string") {
    return { context: { query: { ...query, token: sha256Hex(query.token) } } }
  }
  return undefined
}

const DAY = 60 * 60 * 24

export interface AuthOptions {
  readonly config: AppConfigShape
  /** Whether a user may get a session (an active workspace member). */
  readonly canSignIn: (userId: string) => Promise<boolean>
  readonly trail: TrailWriter
  /** Sends the password reset link through the notification mail service. */
  readonly sendResetPassword: (input: {
    userId: string
    email: string
    url: string
  }) => Promise<void>
  /** Returns the refusal message for a password the workspace rejects, or null when it passes. */
  readonly checkPassword: (password: string) => Promise<string | null>
}

const requestMeta = (request: Request | undefined) => {
  const userAgent = request?.headers.get("user-agent")
  const ip = request?.headers.get(CLIENT_IP_HEADER)
  return { ...(userAgent ? { userAgent } : {}), ...(ip ? { ip } : {}) }
}

/** The password fields Better Auth receives on the paths that set a password. */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
}

const passwordOf = (path: string, body: unknown): string | undefined => {
  const field = PASSWORD_FIELDS[path]
  if (field === undefined || typeof body !== "object" || body === null) return undefined
  const value = (body as Record<string, unknown>)[field]
  return typeof value === "string" ? value : undefined
}

const emailOf = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null
  const value = (body as Record<string, unknown>).email
  return typeof value === "string" ? value : null
}

/** Paths whose successful calls change the account's security and are audited. */
const auditedPaths: Record<string, string> = {
  "/two-factor/enable": "auth.two_factor_enrollment_started",
  "/two-factor/verify-totp": "auth.two_factor_verified",
  "/two-factor/disable": "auth.two_factor_disabled",
  "/two-factor/generate-backup-codes": "auth.backup_codes_regenerated",
  "/passkey/verify-registration": "auth.passkey_added",
  "/passkey/delete-passkey": "auth.passkey_removed",
  "/change-password": "auth.password_changed",
  "/reset-password": "auth.password_reset",
  "/revoke-session": "auth.session_revoked",
  "/revoke-other-sessions": "auth.sessions_revoked",
  "/sign-out": "auth.signed_out",
}

export interface AuthSession {
  readonly session: { readonly id: string; readonly token: string; readonly updatedAt: Date }
  readonly user: { readonly id: string }
}

/** The parts of Better Auth the rest of the server uses. */
export interface AuthHandle {
  readonly handler: (request: Request) => Promise<Response>
  readonly getSession: (
    headers: Headers,
    options?: { readonly disableRefresh?: boolean },
  ) => Promise<AuthSession | null>
  readonly close: () => Promise<void>
}

export const makeAuth = (options: AuthOptions): AuthHandle => {
  const { config } = options
  const signInLockout = makeSignInLockout()
  const resetRequests = makeResetRequestLimit()
  const client = new SQL(Redacted.value(config.databaseUrl), { max: 4 })
  const db = drizzle({ client, relations: defineRelations(authSchema) })
  const secure = config.url.protocol === "https:"

  const auth = betterAuth({
    appName: "audit",
    baseURL: config.url.origin,
    basePath: "/api/auth",
    secret: Redacted.value(config.secretKey),
    trustedOrigins: [config.url.origin],
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by setup and invites, never by public sign-up.
      disableSignUp: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Links straight to the app; Better Auth's own link would look up the raw token.
        const url = new URL(`/reset-password?token=${token}`, config.url).toString()
        await options.sendResetPassword({ userId: user.id, email: user.email, url })
      },
      minPasswordLength: 10,
      password: {
        hash: (password) => Bun.password.hash(password, { algorithm: "argon2id" }),
        verify: ({ hash, password }) => Bun.password.verify(password, hash),
      },
    },
    session: {
      // Upper bound; the workspace session and idle settings are enforced per request (sessions.ts).
      expiresIn: 365 * DAY,
      updateAge: DAY,
    },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax" },
      database: { generateId: () => Bun.randomUUIDv7() },
      // The Bun shell sets this header from the socket or the trusted proxy (see server.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      customRules: {
        // Per client IP. Generous enough for a team behind one office address; brute force against
        // one account is stopped by the per-email lockout instead.
        "/sign-in/email": { window: 60, max: options.config.signInPerIpPerMinute },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => options.canSignIn(String(session.userId)),
          after: async (session, context) => {
            await options.trail({
              actor: { userId: String(session.userId) },
              action: "auth.signed_in",
              entityId: String(session.userId),
              entityType: "user",
              meta: {
                ...requestMeta(context?.request),
                ...(session.ipAddress ? { ip: String(session.ipAddress) } : {}),
              },
            })
          },
        },
      },
      verification: {
        create: {
          before: async (row) => {
            if (!row.identifier.startsWith(RESET_IDENTIFIER_PREFIX)) return undefined
            const token = row.identifier.slice(RESET_IDENTIFIER_PREFIX.length)
            return { data: { ...row, identifier: resetIdentifier(token) } }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          const email = emailOf(ctx.body)
          if (email !== null && signInLockout.lockedFor(email) !== null) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many failed sign-in attempts. Try again later.",
            })
          }
          return
        }
        if (ctx.path === "/request-password-reset") {
          const email = emailOf(ctx.body)
          if (email !== null && !resetRequests.allow(email)) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many password reset requests for this address. Try again later.",
            })
          }
          return
        }
        const password = passwordOf(ctx.path, ctx.body)
        if (password !== undefined) {
          const refusal = await options.checkPassword(password)
          if (refusal !== null) throw new APIError("BAD_REQUEST", { message: refusal })
        }
        if (ctx.path === "/reset-password") return hashResetToken(ctx)
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned
        const failed = returned instanceof APIError
        if (ctx.path === "/sign-in/email") {
          const email = emailOf(ctx.body)
          if (failed) {
            if (email !== null) signInLockout.recordFailure(email)
            await options.trail({
              actor: null,
              action: "auth.sign_in_failed",
              meta: { ...requestMeta(ctx.request), details: { email } },
            })
          } else if (email !== null) {
            signInLockout.reset(email)
          }
          return
        }
        const action = auditedPaths[ctx.path]
        const userId = ctx.context.session?.user.id ?? ctx.context.newSession?.user.id
        if (action === undefined || failed || userId === undefined) return
        await options.trail({
          actor: { userId },
          action,
          entityId: userId,
          entityType: "user",
          meta: requestMeta(ctx.request),
        })
      }),
    },
    plugins: [
      twoFactor({ issuer: "audit", totpOptions: { digits: 6, period: 30 } }),
      passkey({ rpID: config.url.hostname, rpName: "audit", origin: config.url.origin }),
    ],
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: (headers, options) =>
      auth.api.getSession({ headers, query: { disableRefresh: options?.disableRefresh === true } }),
    close: () => client.close(),
  }
}
