import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState, type ReactNode } from "react"
import type { DocNode } from "@audit/domain/docs/schema"
import type { EventOccurrence } from "@audit/domain/calendar/schema"
import type { TaskCard } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { CalendarDays, FileText, Inbox, ListChecks } from "lucide-react"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@audit/ui/components/ui/item.tsx"
import { EntityContextMenu } from "../components/actions/entity-menu.tsx"
import type { EntityTarget } from "../components/actions/types.ts"
import { useKindText } from "../components/inbox/kind.tsx"
import { spaceTreeQuery } from "../components/docs/queries.ts"
import {
  EmptyState,
  ErrorMessage,
  LoadingRows,
  PageBody,
  PageHeader,
} from "../components/feedback.tsx"
import { docHref, taskHref } from "../lib/entity-links.ts"
import { calendarEventsQuery, myTasksQuery, notificationsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/")({
  component: HomePage,
})

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function HomePage() {
  const { me } = Route.useRouteContext()
  const { t } = useLingui()
  return (
    <PageBody>
      <PageHeader title={t`Welcome back, ${me.displayName}`} description={me.workspace.name} />
      <div className="grid gap-4 lg:grid-cols-2">
        <InboxSection />
        <MyTasksSection />
        <RecentDocsSection />
        <UpcomingSection />
      </div>
    </PageBody>
  )
}

function SectionCard({
  title,
  viewAllTo,
  viewAllLabel,
  children,
}: {
  readonly title: string
  readonly viewAllTo: string
  readonly viewAllLabel: string
  readonly children: ReactNode
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to={viewAllTo}>{viewAllLabel}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Row: a focusable link carrying the entity's context menu. */
function LinkRow({
  to,
  target,
  children,
}: {
  readonly to: string
  readonly target: EntityTarget
  readonly children: ReactNode
}) {
  return (
    <EntityContextMenu target={target}>
      <Link
        to={to}
        className="block rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </Link>
    </EntityContextMenu>
  )
}

function InboxSection() {
  const { t } = useLingui()
  const kindText = useKindText()
  const inbox = useQuery(notificationsQuery(false))
  const unread = useMemo(
    () => (inbox.data ?? []).filter((item) => item.readAt === null).slice(0, 5),
    [inbox.data],
  )
  return (
    <SectionCard title={t`Inbox`} viewAllTo="/inbox" viewAllLabel={t`View all`}>
      {inbox.isPending && <LoadingRows rows={3} />}
      {inbox.isError && <ErrorMessage error={inbox.error} />}
      {inbox.isSuccess && unread.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={t`You're all caught up`}
          description={t`New mentions and assignments will show up here.`}
        />
      )}
      {inbox.isSuccess && unread.length > 0 && (
        <ul className="space-y-1">
          {unread.map((notification) => (
            <li key={notification.id}>
              <LinkRow to="/inbox" target={{ kind: "notification", notification }}>
                <Item size="sm" className="px-0">
                  <ItemContent>
                    <ItemTitle>{kindText(notification.kind)}</ItemTitle>
                    <ItemDescription>{notification.createdAt.toLocaleDateString()}</ItemDescription>
                  </ItemContent>
                </Item>
              </LinkRow>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function MyTasksSection() {
  const { t } = useLingui()
  const mine = useQuery(myTasksQuery)
  const tasks = useMemo(() => sortByDue(mine.data ?? []).slice(0, 8), [mine.data])
  return (
    <SectionCard title={t`My tasks`} viewAllTo="/my-tasks" viewAllLabel={t`View all`}>
      {mine.isPending && <LoadingRows rows={3} />}
      {mine.isError && <ErrorMessage error={mine.error} />}
      {mine.isSuccess && tasks.length === 0 && (
        <EmptyState icon={ListChecks} title={t`No open tasks`} />
      )}
      {mine.isSuccess && tasks.length > 0 && (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <LinkRow
                to={taskHref(task.projectKey, taskNumber(task))}
                target={{ kind: "task", task }}
              >
                <Item size="sm" className="px-0">
                  <ItemContent>
                    <ItemTitle>{task.title}</ItemTitle>
                    <ItemDescription>{task.key}</ItemDescription>
                  </ItemContent>
                </Item>
              </LinkRow>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/**
 * Recent docs come from the workspace space tree only: listing every project's tree
 * would take one request per project.
 */
function RecentDocsSection() {
  const { t } = useLingui()
  const space = useQuery(spaceTreeQuery)
  const docs = useMemo(
    () => [...(space.data ?? [])].toSorted((a, b) => recency(b) - recency(a)).slice(0, 8),
    [space.data],
  )
  return (
    <SectionCard title={t`Recent docs`} viewAllTo="/docs" viewAllLabel={t`View all`}>
      {space.isPending && <LoadingRows rows={3} />}
      {space.isError && <ErrorMessage error={space.error} />}
      {space.isSuccess && docs.length === 0 && (
        <EmptyState icon={FileText} title={t`No docs yet`} />
      )}
      {space.isSuccess && docs.length > 0 && (
        <ul className="space-y-1">
          {docs.map((doc) => (
            <li key={doc.id}>
              <LinkRow to={docHref(doc.id, null)} target={{ kind: "doc", doc }}>
                <Item size="sm" className="px-0">
                  <ItemContent>
                    <ItemTitle>{doc.title}</ItemTitle>
                    <ItemDescription>
                      {(doc.lastEditedAt ?? doc.updatedAt).toLocaleDateString()}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </LinkRow>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function UpcomingSection() {
  const { t, i18n } = useLingui()
  const [range] = useState(() => {
    const now = Date.now()
    return { from: new Date(now).toISOString(), to: new Date(now + WEEK_MS).toISOString() }
  })
  const events = useQuery(calendarEventsQuery(range.from, range.to))
  const upcoming = useMemo(
    () =>
      [...(events.data ?? [])]
        .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, 8),
    [events.data],
  )
  const format = useMemo(
    () => new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }),
    [i18n.locale],
  )
  return (
    <SectionCard title={t`Upcoming`} viewAllTo="/calendar" viewAllLabel={t`View all`}>
      {events.isPending && <LoadingRows rows={3} />}
      {events.isError && <ErrorMessage error={events.error} />}
      {events.isSuccess && upcoming.length === 0 && (
        <EmptyState icon={CalendarDays} title={t`Nothing in the next 7 days`} />
      )}
      {events.isSuccess && upcoming.length > 0 && (
        <ul className="space-y-1">
          {upcoming.map((event: EventOccurrence) => (
            <li key={`${event.eventId}-${event.occurrenceStart.getTime()}`}>
              <LinkRow to={`/calendar?event=${event.eventId}`} target={{ kind: "event", event }}>
                <Item size="sm" className="px-0">
                  <ItemContent>
                    <ItemTitle>{event.title}</ItemTitle>
                    <ItemDescription>{format.format(event.startsAt)}</ItemDescription>
                  </ItemContent>
                </Item>
              </LinkRow>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function sortByDue(tasks: ReadonlyArray<TaskCard>): TaskCard[] {
  const open = tasks.filter((task) => task.completedAt === null)
  return [...open].toSorted((a, b) => {
    if (a.dueAt === null) return b.dueAt === null ? 0 : 1
    if (b.dueAt === null) return -1
    return a.dueAt.getTime() - b.dueAt.getTime()
  })
}

/** Task number from its human key (`OPS-42` gives `42`). */
function taskNumber(task: TaskCard): string {
  return task.key.slice(task.key.lastIndexOf("-") + 1)
}

function recency(doc: DocNode): number {
  return (doc.lastEditedAt ?? doc.updatedAt).getTime()
}
