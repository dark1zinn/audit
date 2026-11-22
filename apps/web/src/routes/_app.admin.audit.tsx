import { t as tMacro } from "@lingui/core/macro"
import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useInfiniteQuery, useMutation } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import type { TrailEvent } from "@audit/domain/trail/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Card, CardDescription, CardHeader, CardTitle } from "@audit/ui/components/ui/card.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"

export const Route = createFileRoute("/_app/admin/audit")({
  staticData: { crumb: () => ({ label: tMacro`Audit log` }) },
  component: AuditPage,
})

const PAGE_SIZE = 50

function AuditPage() {
  const { t } = useLingui()
  const [draft, setDraft] = useState("")
  const [action, setAction] = useState("")

  const trail = useInfiniteQuery({
    queryKey: ["trail", action],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      callApi((api) =>
        api.trail.list({
          query: {
            limit: PAGE_SIZE,
            ...(action === "" ? {} : { action }),
            ...(pageParam === undefined ? {} : { before: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  })

  const verify = useMutation({
    mutationFn: () => callApi((api) => api.trail.verify()),
  })

  const events: ReadonlyArray<TrailEvent> = trail.data?.pages.flatMap((page) => page.events) ?? []

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAction(draft.trim())
  }

  return (
    <>
      <PageHeader
        title={t`Audit log`}
        description={t`A tamper-evident record of changes in this workspace.`}
        actions={
          <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
            <Trans>Verify integrity</Trans>
          </Button>
        }
      />
      <div className="space-y-4">
        {verify.data !== undefined && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {verify.data.ok ? <Trans>Chain intact</Trans> : <Trans>Chain broken</Trans>}
              </CardTitle>
              <CardDescription>
                {verify.data.ok ? (
                  <Plural
                    value={verify.data.checked}
                    one="# event checked."
                    other="# events checked."
                  />
                ) : (
                  <Trans>Broken at sequence {verify.data.firstBrokenPos ?? "?"}.</Trans>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {verify.error !== null && <ErrorMessage error={verify.error} />}

        <form className="flex flex-wrap items-end gap-3" onSubmit={onFilter}>
          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="action">
              <Trans>Action</Trans>
            </Label>
            <Input
              id="action"
              value={draft}
              placeholder={t`for example member.role.changed`}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <Trans>Filter</Trans>
          </Button>
        </form>

        {trail.isPending && <LoadingRows />}
        {trail.isError && <ErrorMessage error={trail.error} />}
        {trail.data !== undefined && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Seq</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>When</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Actor</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Action</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Entity</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Changes</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">{event.seq}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {event.at.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.actorName}
                      <span className="block text-xs text-muted-foreground">{event.actorType}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{event.action}</TableCell>
                    <TableCell className="text-xs">
                      {event.entityType}
                      <span className="block font-mono text-muted-foreground">
                        {event.entityId}
                      </span>
                    </TableCell>
                    <TableCell>
                      {event.diff !== null && (
                        <pre className="max-w-xs overflow-x-auto text-xs">
                          {JSON.stringify(event.diff, null, 2)}
                        </pre>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {events.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                <Trans>No events match.</Trans>
              </p>
            )}
          </div>
        )}
        {trail.hasNextPage && (
          <div>
            <Button
              variant="outline"
              disabled={trail.isFetchingNextPage}
              onClick={() => void trail.fetchNextPage()}
            >
              <Trans>Load more</Trans>
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
