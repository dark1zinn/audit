import { useEffect, useId, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"
import type { DocDetail, DocNode } from "@audit/domain/docs/schema"
import type { UserId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@audit/ui/components/ui/collapsible.tsx"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@audit/ui/components/ui/field.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { callApi } from "../../lib/api.ts"
import { membersQuery } from "../../lib/queries.ts"
import { relativeTime } from "../../lib/inbox.ts"
import { ErrorMessage } from "../feedback.tsx"
import { invalidateDoc } from "./queries.ts"
import { usePersistedBoolean } from "./persisted.ts"

const DAY_MS = 86_400_000

/** Whether a doc with a review interval is due. `null` interval means review is off. */
export const reviewState = (
  doc: Pick<DocNode, "reviewEveryDays" | "verifiedAt">,
  now: number,
): "off" | "due" | "current" => {
  if (doc.reviewEveryDays === null || doc.reviewEveryDays === undefined) return "off"
  if (doc.verifiedAt === null || doc.verifiedAt === undefined) return "due"
  const due = new Date(doc.verifiedAt).getTime() + doc.reviewEveryDays * DAY_MS
  return due <= now ? "due" : "current"
}

interface PropertiesPanelProps {
  readonly doc: DocDetail
  readonly projectKey: string | null
  readonly canWrite: boolean
  readonly isManager: boolean
}

/** Current time, refreshed each minute so review dates stay correct on a long-open page. */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Owner, review cadence, restriction and dates for one doc. Read-only users see text. */
export const PropertiesPanel = ({ doc, projectKey, canWrite, isManager }: PropertiesPanelProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePersistedBoolean("audit.docs.props", true)
  const members = useQuery(membersQuery)
  const [days, setDays] = useState(doc.reviewEveryDays === null ? "" : String(doc.reviewEveryDays))
  const [error, setError] = useState<unknown>(null)
  const ownerFieldId = useId()
  const daysFieldId = useId()
  const now = useNow()
  const state = reviewState(doc, now)

  const save = useMutation({
    mutationFn: (payload: { reviewEveryDays: number | null; ownerUserId: UserId | null }) =>
      callApi((api) => api.docs.setReview({ params: { docId: doc.id }, payload })),
    onSuccess: () => {
      setError(null)
      void invalidateDoc(queryClient, doc.id)
    },
    onError: setError,
  })

  const verify = useMutation({
    mutationFn: () => callApi((api) => api.docs.verify({ params: { docId: doc.id } })),
    onSuccess: () => {
      setError(null)
      void invalidateDoc(queryClient, doc.id)
    },
    onError: setError,
  })

  const owner = members.data?.find((member) => member.userId === doc.ownerUserId)
  const author = members.data?.find((member) => member.userId === doc.createdBy)
  const ownerLabel = owner?.displayName ?? t`Unassigned`
  const authorLabel = author?.displayName ?? t`Unknown`
  const saveReview = () => {
    const trimmed = days.trim()
    save.mutate({
      reviewEveryDays: trimmed === "" ? null : Number(trimmed),
      ownerUserId: doc.ownerUserId,
    })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring rounded-sm outline-none min-h-11 md:min-h-0">
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
        />
        <Trans>Properties</Trans>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldGroup className="gap-3 rounded-md border p-3 text-sm">
          {isManager && members.data !== undefined ? (
            <Field>
              <FieldLabel htmlFor={ownerFieldId}>
                <Trans>Owner</Trans>
              </FieldLabel>
              <Select
                value={doc.ownerUserId ?? "none"}
                onValueChange={(value) =>
                  save.mutate({
                    reviewEveryDays: doc.reviewEveryDays,
                    ownerUserId: value === "none" ? null : (value as UserId),
                  })
                }
                disabled={save.isPending}
              >
                <SelectTrigger id={ownerFieldId} className="w-full min-w-0 max-w-full">
                  <SelectValue placeholder={t`Unassigned`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <Trans>Unassigned</Trans>
                  </SelectItem>
                  {members.data.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field orientation="horizontal" className="justify-between gap-2">
              <span className="text-muted-foreground">
                <Trans>Owner</Trans>
              </span>
              <span className="min-w-0 truncate" title={ownerLabel}>
                {ownerLabel}
              </span>
            </Field>
          )}

          {isManager ? (
            <Field>
              <FieldLabel htmlFor={daysFieldId}>
                <Trans>Review every (days)</Trans>
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id={daysFieldId}
                  type="number"
                  min={1}
                  max={3650}
                  value={days}
                  className="w-28 min-w-0"
                  onChange={(event) => setDays(event.target.value)}
                />
                <Button type="button" size="sm" disabled={save.isPending} onClick={saveReview}>
                  <Trans>Save</Trans>
                </Button>
              </div>
              <FieldDescription>
                <Trans>Leave empty to turn review off.</Trans>
              </FieldDescription>
            </Field>
          ) : (
            <Field orientation="horizontal" className="justify-between gap-2">
              <span className="text-muted-foreground">
                <Trans>Review every (days)</Trans>
              </span>
              <span>{doc.reviewEveryDays ?? t`Off`}</span>
            </Field>
          )}

          <Field orientation="horizontal" className="flex-wrap justify-between gap-2">
            <span className="text-muted-foreground">
              <Trans>Verified</Trans>
            </span>
            <FieldContent className="items-end">
              <span className="flex flex-wrap items-center gap-2">
                {state === "due" && (
                  <Badge variant="destructive">
                    <Trans>Needs review</Trans>
                  </Badge>
                )}
                {state === "current" && (
                  <Badge variant="secondary">
                    <Trans>Verified</Trans>
                  </Badge>
                )}
                {doc.verifiedAt !== null && doc.verifiedAt !== undefined && (
                  <span className="text-muted-foreground">
                    {new Date(doc.verifiedAt).toLocaleDateString()}
                  </span>
                )}
                {(canWrite || isManager) && state !== "off" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate()}
                  >
                    <Trans>Mark verified</Trans>
                  </Button>
                )}
              </span>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="justify-between gap-2">
            <span className="text-muted-foreground">
              <Trans>Restricted</Trans>
            </span>
            {doc.restricted ? (
              <span className="flex items-center gap-2">
                <Badge variant="outline">
                  <Trans>Restricted</Trans>
                </Badge>
                {isManager && projectKey !== null && (
                  <Link
                    to="/p/$key/settings"
                    params={{ key: projectKey }}
                    className="text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    <Trans>Manage access</Trans>
                  </Link>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">
                <Trans>Not restricted</Trans>
              </span>
            )}
          </Field>

          <Field orientation="horizontal" className="justify-between gap-2">
            <span className="text-muted-foreground">
              <Trans>Last edited</Trans>
            </span>
            <span title={doc.lastEditedAt === null ? undefined : doc.lastEditedAt.toLocaleString()}>
              {doc.lastEditedAt === null ? t`Never` : relativeTime(doc.lastEditedAt)}
            </span>
          </Field>

          <Field orientation="horizontal" className="justify-between gap-2">
            <span className="text-muted-foreground">
              <Trans>Created by</Trans>
            </span>
            <span className="min-w-0 truncate" title={authorLabel}>
              {authorLabel}
            </span>
          </Field>

          {error !== null && <ErrorMessage error={error} />}
        </FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}
