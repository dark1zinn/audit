import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import type { UserId } from "@audit/domain/ids"
import type { Member } from "@audit/domain/identity/schema"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Card, CardContent } from "@audit/ui/components/ui/card.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
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
import { useMe } from "../components/use-me.ts"
import { membersQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/members")({
  component: MembersPage,
})

type AssignableRole = "admin" | "member" | "guest"

function MembersPage() {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery)
  const [resetLink, setResetLink] = useState<string | null>(null)
  const me = useMe()
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [channelPickerFor, setChannelPickerFor] = useState<Member | null>(null)

  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.members })
    },
  })

  const changeRole = (userId: UserId, role: AssignableRole) =>
    act.mutate(() => callApi((api) => api.members.changeRole({ payload: { userId, role } })))

  const resetPassword = (userId: UserId) =>
    act.mutate(async () => {
      const link = await callApi((api) => api.members.passwordResetLink({ params: { userId } }))
      setResetLink(link.url)
    })

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
      {act.error !== null && (
        <div className="pb-4">
          <ErrorMessage error={act.error} />
        </div>
      )}
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
                <TableHead>
                  <Trans>Two-factor</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Status</Trans>
                </TableHead>
                <TableHead className="text-right">
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
                  <TableRow key={member.userId}>
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
                          onValueChange={(value) =>
                            changeRole(member.userId, value as AssignableRole)
                          }
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
                    <TableCell>
                      <Badge variant={member.twoFactorEnabled ? "default" : "outline"}>
                        {member.twoFactorEnabled ? t`On` : t`Off`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {member.deactivatedAt === null ? (
                        <Trans>Active</Trans>
                      ) : (
                        <Badge variant="secondary">
                          <Trans>Deactivated</Trans>
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!owner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t`Actions for ${member.displayName}`}
                            >
                              <Trans>Actions</Trans>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.deactivatedAt === null ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  act.mutate(() =>
                                    callApi((api) =>
                                      api.members.deactivate({ params: { userId: member.userId } }),
                                    ),
                                  )
                                }
                              >
                                <Trans>Deactivate</Trans>
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  act.mutate(() =>
                                    callApi((api) =>
                                      api.members.reactivate({ params: { userId: member.userId } }),
                                    ),
                                  )
                                }
                              >
                                <Trans>Reactivate</Trans>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() =>
                                act.mutate(() =>
                                  callApi((api) =>
                                    api.members.revokeSessions({
                                      params: { userId: member.userId },
                                    }),
                                  ),
                                )
                              }
                            >
                              <Trans>Sign out everywhere</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                act.mutate(() =>
                                  callApi((api) =>
                                    api.members.resetTwoFactor({
                                      params: { userId: member.userId },
                                    }),
                                  ),
                                )
                              }
                            >
                              <Trans>Reset two-factor</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => resetPassword(member.userId)}>
                              <Trans>Create password reset link</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setChannelPickerFor(member)}>
                              <Trans>Open private channel or DM</Trans>
                            </DropdownMenuItem>
                            {me.role === "owner" && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => setConfirm({ kind: "transfer", member })}
                                >
                                  <Trans>Transfer ownership</Trans>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setConfirm({ kind: "delete", member })}
                                >
                                  <Trans>Delete member</Trans>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "delete" ? (
                <Trans>Delete member</Trans>
              ) : (
                <Trans>Transfer ownership</Trans>
              )}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "delete" ? (
                <Trans>This removes the member's access to the workspace.</Trans>
              ) : (
                <Trans>Ownership moves to this member. Only the current owner can do this.</Trans>
              )}
            </DialogDescription>
          </DialogHeader>
          {act.error !== null && <ErrorMessage error={act.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant={confirm?.kind === "delete" ? "destructive" : "default"}
              disabled={act.isPending}
              onClick={() =>
                confirm !== null &&
                act.mutate(
                  () =>
                    confirm.kind === "delete"
                      ? callApi((api) =>
                          api.people.deleteMember({ params: { userId: confirm.member.userId } }),
                        )
                      : callApi((api) =>
                          api.people.transferOwnership({
                            params: { userId: confirm.member.userId },
                          }),
                        ),
                  {
                    onSuccess: async () => {
                      setConfirm(null)
                      if (confirm.kind === "transfer") {
                        await queryClient.invalidateQueries({ queryKey: keys.session })
                      }
                    },
                  },
                )
              }
            >
              {confirm?.kind === "delete" ? (
                <Trans>Delete member</Trans>
              ) : (
                <Trans>Transfer ownership</Trans>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {channelPickerFor !== null && (
        <ChannelPicker member={channelPickerFor} onClose={() => setChannelPickerFor(null)} />
      )}
    </>
  )
}

type Confirm = { readonly kind: "transfer" | "delete"; readonly member: Member }

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
