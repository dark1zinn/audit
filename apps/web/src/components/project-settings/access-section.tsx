import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { AccessEntry, ProjectDetail } from "@audit/domain/projects/schema"
import {
  ResourceRoles,
  type PrincipalType,
  type ResourceRole,
  type WorkspaceRole,
} from "@audit/domain/roles"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { callApi } from "../../lib/api.ts"
import { membersQuery, projectAccessQuery, teamsQuery } from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { fieldWidth } from "../form.tsx"
import { invalidateProject } from "./invalidate.ts"
import { principalTypes, useSettingsLabels, workspaceRoles } from "./options.ts"

export function AccessSection({ project }: { readonly project: ProjectDetail }) {
  const { t } = useLingui()
  const labels = useSettingsLabels()
  const queryClient = useQueryClient()
  const access = useQuery(projectAccessQuery(project.id))
  const members = useQuery(membersQuery)
  const teams = useQuery(teamsQuery)
  const [principalType, setPrincipalType] = useState<PrincipalType>("user")
  const [principalId, setPrincipalId] = useState("")
  const [role, setRole] = useState<ResourceRole>("viewer")

  const refresh = () => invalidateProject(queryClient, project.id)

  const restrict = useMutation({
    mutationFn: (restricted: boolean) =>
      callApi((api) =>
        api.projects.setRestricted({ params: { projectId: project.id }, payload: { restricted } }),
      ),
    onSuccess: refresh,
  })

  const grant = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.projects.grant({
          params: { projectId: project.id },
          payload: { principalType, principalId, role },
        }),
      ),
    onSuccess: async () => {
      setPrincipalId("")
      await refresh()
    },
  })

  const revoke = useMutation({
    mutationFn: (entry: AccessEntry) =>
      callApi((api) =>
        api.projects.revoke({
          params: { projectId: project.id },
          payload: { principalType: entry.principalType, principalId: entry.principalId },
        }),
      ),
    onSuccess: refresh,
  })

  const error = restrict.error ?? grant.error ?? revoke.error

  const principalName = (entry: AccessEntry): string => {
    switch (entry.principalType) {
      case "user":
        return (
          members.data?.find((member) => member.userId === entry.principalId)?.displayName ??
          entry.principalId
        )
      case "team":
        return teams.data?.find((team) => team.id === entry.principalId)?.name ?? entry.principalId
      case "role":
        return labels.workspaceRole[entry.principalId as WorkspaceRole] ?? entry.principalId
    }
  }

  const options: ReadonlyArray<{ readonly value: string; readonly label: string }> = (() => {
    switch (principalType) {
      case "user":
        return (members.data ?? []).map((member) => ({
          value: member.userId,
          label: member.displayName,
        }))
      case "team":
        return (teams.data ?? []).map((team) => ({ value: team.id, label: team.name }))
      case "role":
        return workspaceRoles.map((workspaceRole) => ({
          value: workspaceRole,
          label: labels.workspaceRole[workspaceRole],
        }))
    }
  })()

  const onGrant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    grant.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Access</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Who can see and manage this project.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="project-restricted">
              <Trans>Restricted</Trans>
            </Label>
            <p className="text-xs text-muted-foreground">
              <Trans>Only the people and teams listed below can see a restricted project.</Trans>
            </p>
          </div>
          <Switch
            id="project-restricted"
            checked={project.visibility === "restricted"}
            disabled={restrict.isPending}
            onCheckedChange={(restricted) => restrict.mutate(restricted)}
          />
        </div>

        {access.isPending && <LoadingRows rows={2} />}
        {access.isError && <ErrorMessage error={access.error} />}
        {access.data !== undefined && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Principal</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Type</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Role</Trans>
                </TableHead>
                <TableHead>
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {access.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    <Trans>No explicit grants.</Trans>
                  </TableCell>
                </TableRow>
              )}
              {access.data.map((entry) => {
                const name = principalName(entry)
                return (
                  <TableRow key={`${entry.principalType}:${entry.principalId}`}>
                    <TableCell>{name}</TableCell>
                    <TableCell>{labels.principalType[entry.principalType]}</TableCell>
                    <TableCell>{labels.resourceRole[entry.role]}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        aria-label={t`Revoke access for ${name}`}
                        onClick={() => revoke.mutate(entry)}
                      >
                        <Trans>Revoke</Trans>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <form
          className="grid gap-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end"
          onSubmit={onGrant}
        >
          <div className="space-y-2">
            <Label htmlFor="grant-type">
              <Trans>Grant to</Trans>
            </Label>
            <Select
              value={principalType}
              onValueChange={(value) => {
                setPrincipalType(value as PrincipalType)
                setPrincipalId("")
              }}
            >
              <SelectTrigger id="grant-type" className={fieldWidth.xs}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {principalTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {labels.principalType[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grant-principal">
              <Trans>Principal</Trans>
            </Label>
            <Select value={principalId} onValueChange={setPrincipalId}>
              <SelectTrigger id="grant-principal" className={fieldWidth.md}>
                <SelectValue placeholder={t`Choose`} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grant-role">
              <Trans>Role</Trans>
            </Label>
            <Select value={role} onValueChange={(value) => setRole(value as ResourceRole)}>
              <SelectTrigger id="grant-role" className={fieldWidth.xs}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ResourceRoles.map((resourceRole) => (
                  <SelectItem key={resourceRole} value={resourceRole}>
                    {labels.resourceRole[resourceRole]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={principalId === "" || grant.isPending}>
            <Trans>Grant access</Trans>
          </Button>
        </form>
        {error !== null && <ErrorMessage error={error} />}
      </CardContent>
    </Card>
  )
}
