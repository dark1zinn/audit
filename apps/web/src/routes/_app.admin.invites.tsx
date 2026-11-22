import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import type { Invite, InviteStatus } from "@audit/domain/identity/schema"
import type { InviteId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
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
import { fieldWidth, formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { invitesQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/invites")({
  staticData: { crumb: () => ({ label: tMacro`Invites` }) },
  component: InvitesPage,
})

const EXPIRY_OPTIONS = [24, 72, 168, 720] as const

const INVITE_PAGE_SIZE = 10

function InvitesPage() {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const invites = useQuery(invitesQuery)
  const [created, setCreated] = useState<string | null>(null)
  const [role, setRole] = useState<"member" | "guest">("member")
  const [expiresInHours, setExpiresInHours] = useState<number>(72)
  const [showAllInvites, setShowAllInvites] = useState(false)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const email = formValue(form, "email").trim()
      const note = formValue(form, "note").trim()
      const maxUses = Number(formValue(form, "maxUses") || "1")
      return callApi((api) =>
        api.invites.create({
          payload: {
            role,
            expiresInHours,
            maxUses,
            ...(email === "" ? {} : { email }),
            ...(note === "" ? {} : { note }),
          },
        }),
      )
    },
    onSuccess: async (result) => {
      setCreated(result.url)
      setCopied(false)
      await queryClient.invalidateQueries({ queryKey: keys.invites })
    },
  })

  const revoke = useMutation({
    mutationFn: (inviteId: InviteId) =>
      callApi((api) => api.invites.revoke({ params: { inviteId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.invites })
    },
  })

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(event.currentTarget)
  }

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  const statusLabel = (status: InviteStatus) => {
    switch (status) {
      case "active":
        return t`Active`
      case "expired":
        return t`Expired`
      case "revoked":
        return t`Revoked`
      case "used":
        return t`Used`
    }
  }

  const allInvites = invites.data ?? []
  const visibleInvites = showAllInvites ? allInvites : allInvites.slice(0, INVITE_PAGE_SIZE)
  return (
    <>
      <PageHeader title={t`Invites`} description={t`Invite people with a one-time link.`} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>New invite</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Leave the email empty to create a link anyone with it can use.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={onCreate}>
              <TextField name="email" type="email" width="md" label={t`Email (optional)`} />
              <div className="space-y-2">
                <Label htmlFor="role">
                  <Trans>Role</Trans>
                </Label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as "member" | "guest")}
                >
                  <SelectTrigger id="role" className={fieldWidth.md}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t`Member`}</SelectItem>
                    <SelectItem value="guest">{t`Guest`}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires">
                  <Trans>Expires in</Trans>
                </Label>
                <Select
                  value={String(expiresInHours)}
                  onValueChange={(value) => setExpiresInHours(Number(value))}
                >
                  <SelectTrigger id="expires" className={fieldWidth.md}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((hours) => (
                      <SelectItem key={hours} value={String(hours)}>
                        {hours === 24
                          ? t`1 day`
                          : hours === 72
                            ? t`3 days`
                            : hours === 168
                              ? t`1 week`
                              : t`30 days`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TextField
                name="maxUses"
                type="number"
                width="xs"
                label={t`Maximum uses`}
                defaultValue={1}
                min={1}
                max={1000}
              />
              <div className="sm:col-span-2">
                <TextField name="note" width="lg" label={t`Note (optional)`} maxLength={500} />
              </div>
              {create.error !== null && (
                <div className="sm:col-span-2">
                  <ErrorMessage error={create.error} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={create.isPending}>
                  <Trans>Create invite</Trans>
                </Button>
              </div>
            </form>
            {created !== null && (
              <div className="space-y-2 rounded-md border p-4">
                <Label htmlFor="invite-url">
                  <Trans>Invite link</Trans>
                </Label>
                <div className="flex gap-2">
                  <Input id="invite-url" readOnly value={created} className="font-mono text-xs" />
                  <Button variant="outline" onClick={() => void copy(created)}>
                    {copied ? t`Copied` : t`Copy`}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {invites.isPending && <LoadingRows />}
        {invites.isError && <ErrorMessage error={invites.error} />}
        {revoke.error !== null && <ErrorMessage error={revoke.error} />}
        {invites.data !== undefined && (
          <div className="overflow-x-auto rounded-md border">
            <Table className="max-sm:block">
              <TableHeader className="max-sm:hidden">
                <TableRow>
                  <TableHead>
                    <Trans>Invite</Trans>
                  </TableHead>
                  <TableHead className="hidden xl:table-cell">
                    <Trans>Status</Trans>
                  </TableHead>
                  <TableHead className="hidden xl:table-cell">
                    <Trans>Uses</Trans>
                  </TableHead>
                  <TableHead className="hidden xl:table-cell">
                    <Trans>Expires</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">
                      <Trans>Actions</Trans>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-sm:block">
                {visibleInvites.map((invite: Invite) => (
                  <TableRow key={invite.id} className="max-sm:block max-sm:border-b max-sm:py-2">
                    <TableCell className="max-sm:block max-sm:whitespace-normal max-sm:px-3 max-sm:pt-1">
                      <div className="font-medium">{invite.email ?? t`Anyone with the link`}</div>
                      <div className="text-xs text-muted-foreground">
                        {invite.role === "guest" ? t`Guest` : t`Member`}
                        {invite.note !== null && ` · ${invite.note}`}
                      </div>
                      <div className="text-xs text-muted-foreground xl:hidden">
                        {statusLabel(invite.status)} · {`${invite.useCount} / ${invite.maxUses}`} ·{" "}
                        {invite.expiresAt.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <Badge variant={invite.status === "active" ? "default" : "outline"}>
                        {statusLabel(invite.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{`${invite.useCount} / ${invite.maxUses}`}</TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {invite.expiresAt.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right max-sm:block max-sm:px-3 max-sm:py-1">
                      {invite.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="max-sm:h-11"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(invite.id)}
                        >
                          <Trans>Revoke</Trans>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {allInvites.length > INVITE_PAGE_SIZE && (
              <div className="border-t p-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllInvites(!showAllInvites)}
                >
                  {showAllInvites ? t`Show fewer` : t`Show all ${allInvites.length}`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
