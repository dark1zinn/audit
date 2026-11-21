import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import type { Member } from "@audit/domain/identity/schema"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Card, CardContent } from "@audit/ui/components/ui/card.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
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
import { EntityActionsButton, EntityContextMenu } from "../components/actions/entity-menu.tsx"
import { useChangeMemberRole } from "../components/actions/member-actions.ts"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"
import { membersQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/members")({
  staticData: { crumb: () => ({ label: tMacro`Members` }) },
  component: MembersPage,
})

const assignableRoles = ["admin", "member", "guest"] as const

function MembersPage() {
  const { t } = useLingui()
  const members = useQuery(membersQuery)
  const [resetLink, setResetLink] = useState<string | null>(null)
  const changeRole = useChangeMemberRole()
  const [channelPickerFor, setChannelPickerFor] = useState<Member | null>(null)

  const roleLabel = (role: WorkspaceRole) => {
    switch (role) {
      case "owner":
        return t`Owner`
      case "admin":
        return t`Admin`
      case "member":
        return t`Member`
      case "guest":
        return t`Guest`
    }
  }

  return (
    <>
      <PageHeader title={t`Members`} description={t`People in this workspace and their access.`} />
      {resetLink !== null && (
        <Card className="mb-4">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">
              <Trans>Password reset link (share it privately)</Trans>
            </p>
            <code className="block break-all font-mono text-xs">{resetLink}</code>
            <Button variant="outline" size="sm" onClick={() => setResetLink(null)}>
              <Trans>Dismiss</Trans>
            </Button>
          </CardContent>
        </Card>
      )}
      <PendingSignups />
      {members.isPending && <LoadingRows />}
      {members.isError && <ErrorMessage error={members.error} />}
      {members.data !== undefined && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Name</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Role</Trans>
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  <Trans>Two-factor</Trans>
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead className="sticky end-0 bg-background text-right">
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.map((member: Member) => {
                const owner = member.role === "owner"
                return (
                  <EntityContextMenu
                    key={member.userId}
                    target={{
                      kind: "member",
                      member,
                      onOpenChannel: () => setChannelPickerFor(member),
                      onResetLink: setResetLink,
                    }}
                  >
                    <TableRow>
                      <TableCell>
                        <div className="font-medium">{member.displayName}</div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </TableCell>
                      <TableCell>
                        {owner ? (
                          roleLabel(member.role)
                        ) : (
                          <Select
                            value={member.role}
                            onValueChange={(value) => {
                              const role = assignableRoles.find((candidate) => candidate === value)
                              if (role !== undefined) changeRole(member.userId, role)
                            }}
                          >
                            <SelectTrigger
                              aria-label={t`Role for ${member.displayName}`}
                              className="w-36"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
                              <SelectItem value="member">{roleLabel("member")}</SelectItem>
                              <SelectItem value="guest">{roleLabel("guest")}</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={member.twoFactorEnabled ? "default" : "outline"}>
                          {member.twoFactorEnabled ? t`On` : t`Off`}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {member.deactivatedAt === null ? (
                          <Trans>Active</Trans>
                        ) : (
                          <Badge variant="secondary">
                            <Trans>Deactivated</Trans>
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="sticky end-0 bg-background text-right">
                        {!owner && (
                          <EntityActionsButton
                            target={{
                              kind: "member",
                              member,
                              onOpenChannel: () => setChannelPickerFor(member),
                              onResetLink: setResetLink,
                            }}
                            label={t`Actions for ${member.displayName}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  </EntityContextMenu>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {channelPickerFor !== null && (
        <ChannelPicker member={channelPickerFor} onClose={() => setChannelPickerFor(null)} />
      )}
    </>
  )
}

/**
 * Sign-ups waiting for an admin (only when the server sends no mail). Approving opens the account;
 * rejecting drops the request. Shown only while there is something to decide.
 */
function PendingSignups() {
  const queryClient = useQueryClient()
  const pending = useQuery({
    queryKey: ["admin", "signups"],
    queryFn: () => callApi((api) => api.admin.pendingSignups()),
  })
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { readonly id: string; readonly approve: boolean }) => {
      if (!approve) {
        await callApi((api) => api.admin.rejectSignup({ params: { id } }))
        return null
      }
      const { url } = await callApi((api) => api.admin.approveSignup({ params: { id } }))
      return url
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "signups"] })
      await queryClient.invalidateQueries({ queryKey: keys.members })
    },
  })
  const approvedLink = typeof decide.data === "string" ? decide.data : null
  const requests = pending.data ?? []

  if (pending.isError) return <ErrorMessage error={pending.error} />
  // Approving the last request empties the list; the link must stay on screen until the admin copies it.
  if (requests.length === 0 && approvedLink === null) return null
  return (
    <div className="mb-4 space-y-2">
      {requests.length > 0 && (
        <h2 className="text-sm font-medium">
          <Trans>Pending sign-ups</Trans>
        </h2>
      )}
      {decide.error !== null && <ErrorMessage error={decide.error} />}
      {approvedLink !== null && (
        <div className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-mono">{approvedLink}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(approvedLink)}
          >
            <Trans>Copy invite link</Trans>
          </Button>
        </div>
      )}
      {requests.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Name</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Email</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Requested</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.name}</TableCell>
                  <TableCell>{request.email}</TableCell>
                  <TableCell>{request.requestedAt.toLocaleString()}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: request.id, approve: true })}
                    >
                      <Trans>Approve</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: request.id, approve: false })}
                    >
                      <Trans>Reject</Trans>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Lists the member's own channel and DM grants; opening one shows it in admin read-only mode. */
function ChannelPicker({
  member,
  onClose,
}: {
  readonly member: Member
  readonly onClose: () => void
}) {
  const { t } = useLingui()
  const access = useQuery({
    queryKey: ["admin", "access", "person", member.userId],
    queryFn: () => callApi((api) => api.admin.accessPerson({ params: { userId: member.userId } })),
  })
  const channels = [
    ...new Map(
      (access.data?.grants ?? [])
        .filter(
          (grant) =>
            grant.entityType === "channel" &&
            grant.principalType === "user" &&
            grant.principalId === member.userId,
        )
        .map((grant) => [grant.entityId, grant] as const),
    ).values(),
  ]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Private channels and DMs</Trans>
          </DialogTitle>
          <DialogDescription>
            {t`Channels that ${member.displayName} belongs to. Opening one is read-only.`}
          </DialogDescription>
        </DialogHeader>
        {access.isPending && <LoadingRows rows={2} />}
        {access.isError && <ErrorMessage error={access.error} />}
        {access.data !== undefined && channels.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Trans>No private channels or direct messages.</Trans>
          </p>
        )}
        {channels.length > 0 && (
          <ul className="grid gap-1">
            {channels.map((grant) => (
              <li key={grant.entityId}>
                <Link
                  to="/admin/channels/$channelId"
                  params={{ channelId: grant.entityId }}
                  onClick={onClose}
                  className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  {grant.entityTitle}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
