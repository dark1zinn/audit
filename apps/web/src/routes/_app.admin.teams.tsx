import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import type { TeamId, UserId } from "@audit/domain/ids"
import type { Team } from "@audit/domain/identity/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { EmptyState, ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { Users } from "lucide-react"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { keys, membersQuery, teamMembersQuery, teamsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/teams")({
  staticData: { crumb: () => ({ label: tMacro`Teams` }) },
  component: TeamsPage,
})

function TeamsPage() {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const teams = useQuery(teamsQuery)
  const [selected, setSelected] = useState<TeamId | null>(null)

  const create = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const name = formValue(form, "name").trim()
      const slug = formValue(form, "slug").trim()
      return callApi((api) => api.teams.create({ payload: { name, slug } }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.teams })
    },
  })

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(event.currentTarget)
    event.currentTarget.reset()
  }

  const workspaceTeams = (teams.data ?? []).filter((team) => team.kind === "workspace")
  const projectTeams = (teams.data ?? []).filter((team) => team.kind === "project")

  return (
    <>
      <PageHeader
        title={t`Teams`}
        description={t`Groups of members used for access and notifications.`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>New team</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={onCreate}>
                <TextField name="name" label={t`Name`} required maxLength={80} />
                <TextField
                  name="slug"
                  label={t`Slug`}
                  required
                  maxLength={60}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  hint={<Trans>Lowercase letters, digits and dashes.</Trans>}
                />
                {create.error !== null && <ErrorMessage error={create.error} />}
                <div>
                  <Button type="submit" disabled={create.isPending}>
                    <Trans>Create team</Trans>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {teams.isPending && <LoadingRows />}
          {teams.isError && <ErrorMessage error={teams.error} />}
          <TeamList
            title={t`Workspace teams`}
            teams={workspaceTeams}
            selected={selected}
            onSelect={setSelected}
          />
          <TeamList
            title={t`Project teams`}
            teams={projectTeams}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {selected === null ? (
          <EmptyState
            icon={Users}
            title={t`No team selected`}
            description={t`Choose a team to see and manage its members.`}
            size="sm"
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Members</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Manage who belongs to this team.</Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TeamMembers teamId={selected} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function TeamList({
  title,
  teams,
  selected,
  onSelect,
}: {
  readonly title: string
  readonly teams: ReadonlyArray<Team>
  readonly selected: TeamId | null
  readonly onSelect: (id: TeamId) => void
}) {
  if (teams.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {teams.map((team) => (
            <li key={team.id}>
              <button
                type="button"
                aria-pressed={selected === team.id}
                onClick={() => onSelect(team.id)}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
              >
                <span className="font-medium">{team.name}</span>
                <Badge variant="outline">{team.memberCount}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function TeamMembers({ teamId }: { readonly teamId: TeamId }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const members = useQuery(teamMembersQuery(teamId))
  const workspaceMembers = useQuery(membersQuery)
  const [userId, setUserId] = useState<UserId | null>(null)
  const [role, setRole] = useState<"member" | "lead">("member")

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.team(teamId) })
    await queryClient.invalidateQueries({ queryKey: keys.teams })
  }

  const setMember = useMutation({
    mutationFn: () => {
      if (userId === null) return Promise.resolve(null)
      return callApi((api) => api.teams.setMember({ payload: { teamId, userId, role } }))
    },
    onSuccess: refresh,
  })

  const removeMember = useMutation({
    mutationFn: (memberId: UserId) =>
      callApi((api) => api.teams.removeMember({ payload: { teamId, userId: memberId } })),
    onSuccess: refresh,
  })

  const error = setMember.error ?? removeMember.error

  return (
    <div className="space-y-4">
      {members.isPending && <LoadingRows rows={3} />}
      {members.isError && <ErrorMessage error={members.error} />}
      {members.data !== undefined && (
        <ul className="divide-y">
          {members.data.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <span>{member.displayName}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{member.role === "lead" ? t`Lead` : t`Member`}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMember.mutate(member.userId)}
                >
                  <Trans>Remove</Trans>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          setMember.mutate()
        }}
      >
        <Select value={userId ?? ""} onValueChange={(value) => setUserId(value as UserId)}>
          <SelectTrigger aria-label={t`Person`}>
            <SelectValue placeholder={t`Choose a person`} />
          </SelectTrigger>
          <SelectContent>
            {(workspaceMembers.data ?? []).map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(value) => setRole(value as "member" | "lead")}>
          <SelectTrigger aria-label={t`Team role`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t`Member`}</SelectItem>
            <SelectItem value="lead">{t`Lead`}</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={userId === null || setMember.isPending}>
          <Trans>Add</Trans>
        </Button>
      </form>
      {error !== null && <ErrorMessage error={error} />}
    </div>
  )
}
