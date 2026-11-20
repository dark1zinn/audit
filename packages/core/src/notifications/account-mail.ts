import { workspace } from "@audit/db/schema"
import type { UserId } from "@audit/domain/ids"
import { translate } from "@audit/i18n/server"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { recipientLocale, workspaceLocale } from "./locale.ts"
import { Mailer } from "./mail.ts"

/** Password reset mail, in the account's locale (profile, then workspace default, then English). */
export const sendResetPasswordEmail = (input: {
  readonly userId: string
  readonly email: string
  readonly url: string
}) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    if (!mailer.enabled) return
    const locale = yield* recipientLocale(input.userId as UserId)
    yield* mailer
      .send({
        to: input.email,
        subject: translate(locale, { id: "email.reset_subject" }),
        text: translate(locale, { id: "email.reset_body" }, { url: input.url }),
      })
      .pipe(Effect.orDie)
  })

/** Invitation mail, in the workspace's default locale: the invitee has no account yet. */
export const sendInviteEmail = (input: { readonly email: string; readonly url: string }) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    if (!mailer.enabled) return
    const db = yield* Db
    const [row] = yield* db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, 1))
      .pipe(Effect.orDie)
    const locale = yield* workspaceLocale
    yield* mailer
      .send({
        to: input.email,
        subject: translate(locale, { id: "email.invite_subject" }, { workspace: row?.name ?? "" }),
        text: translate(locale, { id: "email.invite_body" }, { url: input.url }),
      })
      .pipe(Effect.orDie)
  })

/** Sign-up verification mail, in the workspace's default locale: the applicant has no account yet. */
export const sendSignupVerificationEmail = (input: {
  readonly email: string
  readonly url: string
}) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    if (!mailer.enabled) return
    const locale = yield* workspaceLocale
    yield* mailer
      .send({
        to: input.email,
        subject: translate(locale, {
          id: "email.signup_verify_subject",
          message: "Confirm your sign-up",
        }),
        text: translate(
          locale,
          {
            id: "email.signup_verify_body",
            message:
              "Open this link within 24 hours to create your account:\n\n{url}\n\nIf you did not sign up, ignore this email.",
          },
          { url: input.url },
        ),
      })
      .pipe(Effect.orDie)
  })
