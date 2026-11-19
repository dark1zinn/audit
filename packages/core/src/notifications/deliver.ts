/**
 * Out-of-app delivery for one notification and one channel. Runs as the system actor and re-checks
 * permission and preferences at send time, so a revoked role or a turned-off channel never leaks
 * or sends late content.
 */
import { notifications, pushSubscriptions, user as userTable } from "@audit/db/schema"
import type { EntityId, NotificationId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { translate } from "@audit/i18n/server"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { channelEnabled, type NotificationChannel, type NotificationKind } from "./notify.ts"
import { Mailer } from "./mail.ts"
import { PushTransport } from "./push.ts"
import { recipientLocale } from "./locale.ts"

/** Notification kinds with their own catalog message; anything else uses the generic text. */
const KNOWN_KINDS: Record<string, true> = {
  mention: true,
  task_assigned: true,
  task_unassigned: true,
  task_changed: true,
  comment_added: true,
  task_due_soon: true,
  task_overdue: true,
  doc_review_due: true,
  direct_message: true,
  thread_reply: true,
  invite_accepted: true,
}

interface Rendered {
  readonly title: string
  readonly body: string
}

/** Title and body of a notification in the recipient's locale. */
const render = (
  kind: string,
  payload: Record<string, unknown>,
  actor: string,
  locale: string | null,
): Rendered => {
  const item = [payload.taskKey, payload.title]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
  const id = KNOWN_KINDS[kind] === true ? `notify.${kind}` : "notify.fallback"
  return {
    title: translate(locale, { id: "notify.fallback" }),
    body: translate(locale, { id }, { actor, title: item || "" }),
  }
}

/** Sends one notification on one out-of-app channel. */
export const deliverNotification = (input: {
  readonly notificationId: string
  readonly channel: NotificationChannel
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const push = yield* PushTransport
    const mailer = yield* Mailer
    if (input.channel === "email" && !mailer.enabled) return
    const [row] = yield* db
      .select()
      .from(notifications)
      .where(eq(notifications.id, input.notificationId as NotificationId))
      .pipe(Effect.orDie)
    if (!row || row.archivedAt !== null) return
    const userId = row.userId as UserId
    const entityId = row.entityId as EntityId
    if ((yield* authz.roleOn(userId, entityId)) === null) return
    const enabled = yield* channelEnabled(userId, row.kind as NotificationKind, input.channel)
    if (!enabled) return
    const locale = yield* recipientLocale(userId)
    const [account] = yield* db
      .select({ name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .pipe(Effect.orDie)
    const actor = row.actorId
      ? yield* db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, row.actorId))
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows[0]?.name ?? ""),
          )
      : ""
    const message = render(row.kind, row.payload, actor, locale)
    if (input.channel === "push") {
      const subscriptions = yield* db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .pipe(Effect.orDie)
      const payload = JSON.stringify({ title: message.title, body: message.body, url: "/inbox" })
      for (const subscription of subscriptions) {
        const outcome = yield* push.send(subscription, payload)
        if (outcome === "gone")
          yield* db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, subscription.id))
            .pipe(Effect.orDie)
      }
      return
    }
    if (!account) return
    const footer = translate(locale, { id: "email.footer" })
    yield* mailer
      .send({ to: account.email, subject: message.title, text: `${message.body}\n\n${footer}` })
      .pipe(Effect.orDie)
  })
