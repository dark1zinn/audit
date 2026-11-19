import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ResourceRole } from "@audit/domain/roles"
import type { ProjectVisibility } from "@audit/domain/projects/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { useState, type FormEvent } from "react"
import { ErrorMessage } from "./feedback.tsx"
import { formValue, TextField } from "./form.tsx"
import { callApi } from "../lib/api.ts"
import { keys } from "../lib/queries.ts"

/** Creates a project and opens its board. The server answers Forbidden without the capability. */
export function ProjectCreateDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [visibility, setVisibility] = useState<ProjectVisibility>("workspace")
  const [memberRole, setMemberRole] = useState<ResourceRole>("editor")

  const create = useMutation({
    mutationFn: (form: HTMLFormElement) =>
      callApi((api) =>
        api.projects.create({
          payload: {
            key: formValue(form, "key").trim().toUpperCase(),
            name: formValue(form, "name").trim(),
            visibility,
            memberRole,
          },
        }),
      ),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects })
      await queryClient.invalidateQueries({ queryKey: keys.adminProjects })
      onOpenChange(false)
      await navigate({ to: "/p/$key/board", params: { key: project.key } })
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(event.currentTarget)
  }

  const roleLabel = (value: ResourceRole) => {
    switch (value) {
      case "viewer":
        return t`Viewer`
      case "commenter":
        return t`Commenter`
      case "editor":
        return t`Editor`
      case "manager":
        return t`Manager`
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New project</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>The key prefixes task numbers, for example ABC-12.</Trans>
          </DialogDescription>
        </DialogHeader>
        <form id="create-project" className="grid gap-3" onSubmit={onSubmit}>
          <TextField
            name="key"
            label={t`Key`}
            required
            minLength={2}
            maxLength={6}
            pattern="[A-Za-z]{2,6}"
            autoCapitalize="characters"
            hint={<Trans>2 to 6 letters. Stored in uppercase.</Trans>}
          />
          <TextField name="name" label={t`Name`} required maxLength={120} />
          <div className="space-y-2">
            <Label htmlFor="visibility">
              <Trans>Visibility</Trans>
            </Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as ProjectVisibility)}
            >
              <SelectTrigger id="visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["workspace", "restricted"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "workspace" ? t`Whole workspace` : t`Restricted to members`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="memberRole">
              <Trans>Default member role</Trans>
            </Label>
            <Select
              value={memberRole}
              onValueChange={(value) => setMemberRole(value as ResourceRole)}
            >
              <SelectTrigger id="memberRole" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["viewer", "commenter", "editor", "manager"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {roleLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {create.error !== null && <ErrorMessage error={create.error} />}
        </form>
        <DialogFooter>
          <Button type="submit" form="create-project" disabled={create.isPending}>
            <Trans>Create project</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
