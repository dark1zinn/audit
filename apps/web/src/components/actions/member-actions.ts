import { useLingui } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Copy,
  KeyRound,
  LogOut,
  MessageSquare,
  ShieldOff,
  ShieldCheck,
  Trash2,
  UserCog,
  Link2,
} from "lucide-react"
import { toast } from "sonner"
import type { UserId } from "@audit/domain/ids"
import type { ChangeRoleInput } from "@audit/domain/identity/schema"
import { callApi } from "../../lib/api.ts"
import { keys, sessionQuery } from "../../lib/queries.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { useCopyText, useGo, useRunAction } from "./shared.ts"

type MemberTarget = Extract<EntityTarget, { kind: "member" }>

export const useMemberActions = (target: MemberTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  const queryClient = useQueryClient()
  const me = useQuery(sessionQuery)
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: keys.members }))
  if (target === null) return []
  const { member } = target
  const userId = member.userId as UserId
  const isAdmin = me.data?.role === "owner" || me.data?.role === "admin"
  const isOwner = me.data?.role === "owner"
  const deactivated = member.deactivatedAt !== null

  const admin: ReadonlyArray<ActionGroup[number]> = isAdmin
    ? [
        {
          id: "deactivate",
          label: deactivated ? t`Reactivate` : t`Deactivate`,
          icon: deactivated ? ShieldCheck : ShieldOff,
          variant: deactivated ? "default" : "destructive",
          confirm: deactivated
            ? undefined
            : {
                title: t`Deactivate ${member.displayName}?`,
                description: t`They lose access until reactivated.`,
                confirmLabel: t`Deactivate`,
              },
          run: () =>
            run.mutate(() =>
              deactivated
                ? callApi((api) => api.members.reactivate({ params: { userId } }))
                : callApi((api) => api.members.deactivate({ params: { userId } })),
            ),
        },
        {
          id: "revoke-sessions",
          label: t`Sign out everywhere`,
          icon: LogOut,
          run: () =>
            run.mutate(() => callApi((api) => api.members.revokeSessions({ params: { userId } })), {
              onSuccess: () => toast.success(t`Sessions revoked`),
            }),
        },
        {
          id: "reset-2fa",
          label: t`Reset two-factor`,
          icon: KeyRound,
          disabled: !member.twoFactorEnabled,
          disabledReason: member.twoFactorEnabled ? undefined : t`Two-factor is not enabled`,
          confirm: {
            title: t`Reset two-factor for ${member.displayName}?`,
            description: t`They will set up two-factor again on next sign-in.`,
            confirmLabel: t`Reset`,
          },
          run: () =>
            run.mutate(() => callApi((api) => api.members.resetTwoFactor({ params: { userId } }))),
        },
        {
          id: "reset-link",
          label: t`Create password reset link`,
          icon: Link2,
          run: () =>
            run.mutate(async () => {
              const link = await callApi((api) =>
                api.members.passwordResetLink({ params: { userId } }),
              )
              target.onResetLink?.(link.url)
            }),
        },
        { id: "open-channel", label: t`Open private channel or DM`, run: target.onOpenChannel },
      ]
    : []

  const owner: ReadonlyArray<ActionGroup[number]> = isOwner
    ? [
        {
          id: "transfer",
          label: t`Transfer ownership`,
          icon: UserCog,
          confirm: {
            title: t`Transfer ownership to ${member.displayName}?`,
            description: t`You become an admin. This cannot be undone without the new owner.`,
            confirmLabel: t`Transfer`,
          },
          run: () =>
            run.mutate(
              () => callApi((api) => api.people.transferOwnership({ params: { userId } })),
              {
                onSuccess: () => {
                  void queryClient.invalidateQueries({ queryKey: keys.session })
                  toast.success(t`Ownership transferred`)
                },
              },
            ),
        },
        {
          id: "delete-member",
          label: t`Delete member`,
          icon: Trash2,
          variant: "destructive",
          confirm: {
            title: t`Delete ${member.displayName}?`,
            description: t`Their account and access are removed.`,
            confirmLabel: t`Delete`,
          },
          run: () =>
            run.mutate(() => callApi((api) => api.people.deleteMember({ params: { userId } }))),
        },
      ]
    : []

  return [
    [
      {
        id: "message",
        label: t`Message`,
        icon: MessageSquare,
        run: () => go(`/dm/${member.userId}`),
      },
      {
        id: "copy-email",
        label: t`Copy email`,
        icon: Copy,
        run: () => copy(member.email, t`Email copied`),
      },
    ],
    ...(admin.length > 0 ? [admin] : []),
    ...(owner.length > 0 ? [owner] : []),
  ]
}

/** Role change from the members table's role select, which is not a menu item. */
export const useChangeMemberRole = () => {
  const queryClient = useQueryClient()
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: keys.members }))
  return (userId: UserId, role: ChangeRoleInput["role"]) =>
    run.mutate(() => callApi((api) => api.members.changeRole({ payload: { userId, role } })))
}
