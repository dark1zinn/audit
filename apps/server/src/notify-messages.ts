/**
 * Catalog anchor. Lingui only keeps message ids whose `msg` call appears under a scanned source
 * path; the server looks messages up by id at runtime and cannot use the macro itself. This module
 * is never imported at runtime and is excluded from tsconfig, so it exists only for `lingui extract`.
 * Keep it in sync with the ids used by notification and email text in packages/core.
 */
import { msg } from "@lingui/core/macro"

export const notifyMessages = [
  msg({ id: "notify.mention", message: "{actor} mentioned you on {title}" }),
  msg({ id: "notify.task_assigned", message: "{actor} assigned you {title}" }),
  msg({ id: "notify.task_unassigned", message: "{actor} removed you from {title}" }),
  msg({ id: "notify.task_changed", message: "{title} was updated" }),
  msg({ id: "notify.comment_added", message: "New comment on {title}" }),
  msg({ id: "notify.task_due_soon", message: "{title} is due soon" }),
  msg({ id: "notify.task_overdue", message: "{title} is overdue" }),
  msg({ id: "notify.doc_review_due", message: "{title} needs review" }),
  msg({ id: "notify.direct_message", message: "New message from {actor}" }),
  msg({ id: "notify.thread_reply", message: "New reply from {actor}" }),
  msg({ id: "notify.invite_accepted", message: "{actor} accepted their invitation" }),
  msg({ id: "notify.fallback", message: "You have a new notification" }),
  msg({
    id: "email.footer",
    message:
      "You receive this email because email notifications are on. Change this in your settings.",
  }),
  msg({ id: "email.reset_subject", message: "Reset your password" }),
  msg({ id: "email.reset_body", message: "Use this link to reset your password: {url}" }),
  msg({ id: "email.invite_subject", message: "You were invited to {workspace}" }),
  msg({ id: "email.invite_body", message: "Accept your invitation: {url}" }),
]
