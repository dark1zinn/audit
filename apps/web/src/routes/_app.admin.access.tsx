import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { useState, type FormEvent } from "react"
import { EntityId, UserId } from "@audit/domain/ids"
import type { AccessGrant, PersonGrant } from "@audit/domain/admin/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { fieldWidth } from "../components/form.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
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
import { keys, membersQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/access")({
  staticData: { crumb: () => ({ label: tMacro`Access review` }) },
  component: AccessPage,
})

const decodeEntityId = Schema.decodeUnknownOption(EntityId)
const decodeUserId = Schema.decodeUnknownOption(UserId)

function AccessPage() {
  const { t } = useLingui()
  const members = useQuery(membersQuery)
  const [itemDraft, setItemDraft] = useState("")
  const [entityId, setEntityId] = useState<EntityId | undefined>(undefined)
  const [itemInvalid, setItemInvalid] = useState(false)
  const [userId, setUserId] = useState<UserId | undefined>(undefined)

  const item = useQuery({
    queryKey:
      entityId === undefined
        ? ["admin", "access", "items", "none"]
        : keys.adminAccessItem(entityId),
    queryFn: () => callApi((api) => api.admin.accessItem({ params: { entityId: entityId! } })),
    enabled: entityId !== undefined,
    retry: false,
  })

  const person = useQuery({
    queryKey:
      userId === undefined ? ["admin", "access", "people", "none"] : keys.adminAccessPerson(userId),
    queryFn: () => callApi((api) => api.admin.accessPerson({ params: { userId: userId! } })),
    enabled: userId !== undefined,
    retry: false,
  })

  const nameOf = (id: string | null): string => {
    if (id === null) return t`Unknown`
    const member = members.data?.find((candidate) => candidate.userId === id)
    return member?.displayName ?? id
  }

  const onLookupItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const decoded = decodeEntityId(itemDraft.trim())
    if (Option.isNone(decoded)) {
      setItemInvalid(true)
      setEntityId(undefined)
      return
    }
    setItemInvalid(false)
    setEntityId(decoded.value)
  }

  const onPickPerson = (value: string) => {
    const decoded = decodeUserId(value)
    setUserId(Option.getOrUndefined(decoded))
  }

  return (
    <>
      <PageHeader
        title={t`Access review`}
        description={t`See who can reach an item, and what a person can reach. Read only.`}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Item access</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Enter an item ID to see its direct grants and effective access.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-3" onSubmit={onLookupItem}>
              <div className="space-y-2">
                <Label htmlFor="entityId">
                  <Trans>Item ID</Trans>
                </Label>
                <Input
                  id="entityId"
                  className={fieldWidth.lg}
                  value={itemDraft}
                  onChange={(event) => setItemDraft(event.currentTarget.value)}
                  aria-invalid={itemInvalid}
                  aria-describedby={itemInvalid ? "entityId-error" : undefined}
                />
              </div>
              <div>
                <Button type="submit" variant="outline">
                  <Trans>Look up</Trans>
                </Button>
              </div>
            </form>
            {itemInvalid && (
              <p id="entityId-error" role="alert" className="text-sm text-destructive">
                <Trans>That is not a valid item ID.</Trans>
              </p>
            )}
            {item.isFetching && <LoadingRows rows={2} />}
            {item.isError && <ErrorMessage error={item.error} />}
            {item.data !== undefined && (
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="font-medium">{item.data.entityTitle}</span>{" "}
                  <Badge variant="secondary">{item.data.entityType}</Badge>
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Trans>Principal</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Role</Trans>
                        </TableHead>
                        <TableHead>
                          <Trans>Path</Trans>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {item.data.grants.map((grant, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-sm">
                            <GrantPrincipal grant={grant} nameOf={nameOf} />
                          </TableCell>
                          <TableCell className="text-sm">{grant.role}</TableCell>
                          <TableCell className="text-sm">
                            <GrantPath grant={grant} restricted={item.data.restricted} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h2 className="pb-2 text-sm font-medium">
                    <Trans>Effective access</Trans>
                  </h2>
                  {item.data.effective.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <Trans>No active member can reach this item.</Trans>
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {item.data.effective.map((entry) => (
                        <li key={entry.userId} className="flex justify-between gap-4">
                          <span>{nameOf(entry.userId)}</span>
                          <span className="text-muted-foreground">{entry.role}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Person access</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Choose a person to see every container they can reach and why.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {members.isPending && <LoadingRows rows={2} />}
            {members.isError && <ErrorMessage error={members.error} />}
            {members.data !== undefined && (
              <div className="space-y-2">
                <Label htmlFor="personId">
                  <Trans>Person</Trans>
                </Label>
                <Select value={userId ?? ""} onValueChange={onPickPerson}>
                  <SelectTrigger id="personId" className={fieldWidth.lg}>
                    <SelectValue placeholder={t`Choose a person`} />
                  </SelectTrigger>
                  <SelectContent>
                    {members.data.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {person.isFetching && <LoadingRows rows={2} />}
            {person.isError && <ErrorMessage error={person.error} />}
            {person.data !== undefined && (
              <div className="space-y-4">
                <p className="text-sm">
                  <Trans>Workspace role:</Trans>{" "}
                  <Badge variant="secondary">{person.data.workspaceRole ?? t`None`}</Badge>
                </p>
                {person.data.grants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Trans>No containers are shared with this person.</Trans>
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Trans>Container</Trans>
                          </TableHead>
                          <TableHead>
                            <Trans>Role</Trans>
                          </TableHead>
                          <TableHead>
                            <Trans>Path</Trans>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {person.data.grants.map((grant, index) => (
                          <TableRow key={index}>
                            <TableCell className="text-sm">
                              {grant.entityTitle}{" "}
                              <span className="text-muted-foreground">({grant.entityType})</span>
                            </TableCell>
                            <TableCell className="text-sm">{grant.role}</TableCell>
                            <TableCell className="text-sm">
                              <PersonPath grant={grant} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function GrantPrincipal({
  grant,
  nameOf,
}: {
  readonly grant: AccessGrant
  readonly nameOf: (id: string | null) => string
}) {
  const { t } = useLingui()
  switch (grant.principalType) {
    case "user":
      return nameOf(grant.principalId)
    case "team":
      return t`Team ${grant.principalId ?? ""}`
    case "role":
      return t`Everyone with role ${grant.principalRole ?? ""}`
  }
}

/** Why the grant applies: a direct grant, a team, a role, inherited from a container, or a boundary. */
function GrantPath({
  grant,
  restricted = false,
}: {
  readonly grant: AccessGrant
  readonly restricted?: boolean
}) {
  const { t } = useLingui()
  const label = (() => {
    switch (grant.source) {
      case "direct":
        return t`Direct`
      case "team":
        return t`Through team`
      case "role":
        return t`Through role`
      case "inherited":
        return t`Inherited from container`
    }
  })()
  return (
    <span className="flex flex-wrap gap-2">
      <Badge variant="outline">{label}</Badge>
      {restricted && <Badge variant="secondary">{t`Restricted boundary`}</Badge>}
    </span>
  )
}

/** How one person reaches a container: the path, whether it flows down, and what it stops at. */
function PersonPath({ grant }: { readonly grant: PersonGrant }) {
  const { t } = useLingui()
  return (
    <span className="flex flex-wrap gap-2">
      <GrantPath grant={grant} restricted={grant.restricted} />
      {grant.teamName !== null && <Badge variant="outline">{grant.teamName}</Badge>}
      <Badge variant="outline">
        {grant.scope === "container" ? t`Covers children` : t`This item only`}
      </Badge>
      {grant.restrictedChildren > 0 && (
        <Badge variant="secondary">
          {t`${grant.restrictedChildren} restricted children need their own grant`}
        </Badge>
      )}
    </span>
  )
}
