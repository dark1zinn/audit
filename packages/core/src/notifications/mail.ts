/**
 * Outbound email over SMTP (nodemailer). Without an SMTP URL the mailer is disabled and email
 * channels stay off; callers check `enabled` instead of failing.
 */
import { Context, Effect, Layer } from "effect"
import nodemailer from "nodemailer"

export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
}

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly enabled: boolean
    readonly send: (message: MailMessage) => Effect.Effect<void, MailError>
  }
>()("@audit/core/Mailer") {
  /** SMTP mailer. `smtpUrl` is a nodemailer URL such as `smtp://user:pass@host:587`. */
  static readonly smtp = (smtpUrl: string, from: string) =>
    Layer.effect(
      Mailer,
      Effect.sync(() => {
        const transport = nodemailer.createTransport(smtpUrl)
        return {
          enabled: true,
          send: (message: MailMessage) =>
            Effect.tryPromise({
              try: () => transport.sendMail({ from, ...message }),
              catch: (cause) => new MailError({ message: String(cause) }),
            }).pipe(Effect.asVoid),
        }
      }),
    )

  /** No SMTP configured: email channels are unavailable. */
  static readonly disabled = Layer.succeed(Mailer, {
    enabled: false,
    send: () => Effect.fail(new MailError({ message: "email is not configured" })),
  })

  /** Captures messages in memory; used by tests. */
  static readonly recording = (sent: MailMessage[]) =>
    Layer.succeed(Mailer, {
      enabled: true,
      send: (message: MailMessage) =>
        Effect.sync(() => {
          sent.push(message)
        }),
    })
}

export class MailError extends Error {
  readonly _tag = "MailError"
  constructor(readonly props: { readonly message: string }) {
    super(props.message)
  }
}
