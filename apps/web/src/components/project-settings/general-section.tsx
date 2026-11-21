import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { UserId } from "@audit/domain/ids"
import type { ProjectDetail, ProjectVisibility } from "@audit/domain/projects/schema"
import { ResourceRoles, type ResourceRole } from "@audit/domain/roles"
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
import { callApi } from "../../lib/api.ts"
import { membersQuery } from "../../lib/queries.ts"
import { ErrorMessage } from "../feedback.tsx"
import { fieldWidth, TextField } from "../form.tsx"
import { invalidateProject } from "./invalidate.ts"
import { useSettingsLabels } from "./options.ts"

const NO_LEAD = "none"

export function GeneralSection({ project }: { readonly project: ProjectDetail }) {
  const { t } = useLingui()
  const labels = useSettingsLabels()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery)
  const [name, setName] = useState(project.name)
  const [leadUserId, setLeadUserId] = useState<UserId | null>(project.leadUserId)
  const [visibility, setVisibility] = useState<ProjectVisibility>(project.visibility)
  const [memberRole, setMemberRole] = useState<ResourceRole>(project.memberRole)

  const save = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.projects.update({
          params: { projectId: project.id },
          payload: {
            name: name.trim(),
            leadUserId,
            visibility,
            memberRole,
            version: project.version,
          },
        }),
      ),
    onSuccess: () => invalidateProject(queryClient, project.id),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>General</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Name, lead, visibility and the default role of workspace members.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <TextField
            name="name"
            width="md"
            label={t`Name`}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="space-y-2">
            <Label htmlFor="project-lead">
              <Trans>Lead</Trans>
            </Label>
            <Select
              value={leadUserId ?? NO_LEAD}
              onValueChange={(value) => setLeadUserId(value === NO_LEAD ? null : (value as UserId))}
            >
              <SelectTrigger id="project-lead" className={fieldWidth.sm}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEAD}>
                  <Trans>No lead</Trans>
                </SelectItem>
                {(members.data ?? []).map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-visibility">
              <Trans>Visibility</Trans>
            </Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as ProjectVisibility)}
            >
              <SelectTrigger id="project-visibility" className={fieldWidth.sm}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">{labels.visibility.workspace}</SelectItem>
                <SelectItem value="restricted">{labels.visibility.restricted}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-member-role">
              <Trans>Member role</Trans>
            </Label>
            <Select
              value={memberRole}
              onValueChange={(value) => setMemberRole(value as ResourceRole)}
            >
              <SelectTrigger id="project-member-role" className={fieldWidth.sm}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ResourceRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {labels.resourceRole[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {save.error !== null && <ErrorMessage error={save.error} />}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending || name.trim().length === 0}>
              <Trans>Save changes</Trans>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
