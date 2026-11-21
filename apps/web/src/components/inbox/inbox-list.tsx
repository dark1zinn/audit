import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import type { Notification } from "@audit/domain/notifications/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { groupByItem, relativeTime, snippetOf, targetOf, type InboxGroup } from "../../lib/inbox.ts"
import { membersQuery } from "../../lib/queries.ts"
import { useInboxActions } from "./actions.ts"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import { KindIcon, useKindText } from "./kind.tsx"
import { channelHref, docHref, messageHref, taskHref } from "../../lib/entity-links.ts"

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/**
 * The inbox list: one row per item. j/k (or arrows) move the active row, Enter opens it
 * (its Open button has focus), r toggles read, e archives or unarchives.
 */
export function InboxList({
  notifications,
  archived,
}: {
  readonly notifications: ReadonlyArray<Notification>
  readonly archived: boolean
}) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const members = useQuery(membersQuery)
  const kindText = useKindText()
  const actions = useInboxActions()
  const groups = useMemo(() => groupByItem(notifications), [notifications])
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(groups.length - 1, 0))

  const nameOf = (userId: string) =>
    members.data?.find((member) => member.userId === userId)?.displayName

  const open = (group: InboxGroup) => {
    const target = targetOf(group.latest)
    if (group.unread > 0) void actions.setRead(group.items, true)
    if (target === null) return
    switch (target.to) {
      case "task":
        void navigate({ to: taskHref(target.projectKey, target.number) })
        return
      case "doc":
        void navigate({ to: docHref(target.docId, null) })
        return
      case "channel":
        void navigate({ to: channelHref(target.channelId) })
        return
      case "thread":
        void navigate({ to: messageHref(target.channelId, target.threadId) })
        return
      case "calendar":
        void navigate({ to: "/calendar" })
        return
    }
  }

  const toggleRead = (group: InboxGroup) => void actions.setRead(group.items, group.unread === 0)

  const toggleArchive = (group: InboxGroup) => void actions.setArchived(group.items, !archived)

  const focusRow = (position: number) => {
    const key = groups[position]?.key
    setSelected(position)
    if (key !== undefined) document.getElementById(`inbox-open-${key}`)?.focus()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const group = groups[index]
      if (group === undefined) return
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault()
          focusRow(Math.min(index + 1, groups.length - 1))
          return
        case "k":
        case "ArrowUp":
          event.preventDefault()
          focusRow(Math.max(index - 1, 0))
          return
        case "r":
          toggleRead(group)
          return
        case "e":
          toggleArchive(group)
          return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // Handlers close over the current rows; re-register when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, index, archived])

  return (
    <>
      {actions.error !== null && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          <Trans>Something went wrong. Try again.</Trans>
        </p>
      )}
      <ul aria-label={t`Notifications`} className="divide-y rounded-md border">
        {groups.map((group, position) => {
          const latest = group.latest
          const target = targetOf(latest)
          const actor = latest.actorId === null ? undefined : nameOf(latest.actorId)
          const snippet = snippetOf(latest)
          const title =
            typeof latest.payload.title === "string" ? latest.payload.title : kindText(latest.kind)
          const active = position === index
          const notificationTarget = {
            kind: "notification" as const,
            notification: latest,
            items: group.items,
            onOpen: () => open(group),
          }
          return (
            <EntityContextMenu key={group.key} target={notificationTarget}>
              <li
                aria-current={active ? "true" : undefined}
                className={`flex flex-wrap items-start gap-3 p-3 ${active ? "bg-accent" : ""}`}
              >
                <span className="block size-2 shrink-0 translate-y-2" aria-hidden="true">
                  {group.unread > 0 && <span className="block size-2 rounded-full bg-primary" />}
                </span>
                <KindIcon kind={latest.kind} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{kindText(latest.kind)}</span>
                    {group.items.length > 1 && (
                      <Badge variant="secondary">
                        <Plural
                          value={group.items.length}
                          one="# notification"
                          other="# notifications"
                        />
                      </Badge>
                    )}
                  </div>
                  <p className="truncate font-medium">{title}</p>
                  {snippet !== "" && (
                    <p className="truncate text-sm text-muted-foreground">{snippet}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {actor !== undefined && <span>{actor} · </span>}
                    <time dateTime={latest.createdAt.toISOString()}>
                      {relativeTime(latest.createdAt)}
                    </time>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    id={`inbox-open-${group.key}`}
                    size="sm"
                    variant="outline"
                    disabled={target === null}
                    onClick={() => open(group)}
                    aria-label={t`Open ${title}`}
                  >
                    <Trans>Open</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleRead(group)}
                    aria-label={group.unread === 0 ? t`Mark as unread` : t`Mark as read`}
                  >
                    {group.unread === 0 ? <Trans>Mark unread</Trans> : <Trans>Mark read</Trans>}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleArchive(group)}
                    aria-label={archived ? t`Unarchive` : t`Archive`}
                  >
                    {archived ? <Trans>Unarchive</Trans> : <Trans>Archive</Trans>}
                  </Button>
                  <EntityActionsButton
                    target={notificationTarget}
                    label={t`Actions for ${title}`}
                  />
                </div>
              </li>
            </EntityContextMenu>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        <Trans>Keys: j/k move, Enter open, r read or unread, e archive or unarchive.</Trans>
      </p>
    </>
  )
}
