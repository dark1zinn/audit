import { Trans, useLingui } from "@lingui/react/macro"
import { useNavigate } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import type { ProjectDetail } from "@audit/domain/projects/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { useProjectActions } from "../actions/project-actions.ts"
import { TextField } from "../form.tsx"

export function LifecycleSection({ project }: { readonly project: ProjectDetail }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [confirmKey, setConfirmKey] = useState("")
  const archived = project.status === "archived"
  const actions = useProjectActions({
    kind: "project",
    project,
    onDeleted: () => {
      void navigate({ to: "/" })
    },
  }).flat()
  const toggleArchive = actions.find((action) => action.id === "archive")
  const removeProject = actions.find((action) => action.id === "delete")

  const onDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (confirmKey === project.key) removeProject?.run?.()
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{archived ? <Trans>Archived</Trans> : <Trans>Archive</Trans>}</CardTitle>
          <CardDescription>
            {archived ? (
              <Trans>This project is read-only. Unarchive it to allow changes again.</Trans>
            ) : (
              <Trans>Archived projects are read-only for everyone.</Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={() => toggleArchive?.run?.()}>
            {archived ? <Trans>Unarchive project</Trans> : <Trans>Archive project</Trans>}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">
            <Trans>Delete project</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Deleting removes the project, its boards and tasks. Type the project key to confirm.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:max-w-md" onSubmit={onDelete}>
            <TextField
              name="confirm-key"
              label={t`Type ${project.key} to confirm`}
              autoComplete="off"
              value={confirmKey}
              onChange={(event) => setConfirmKey(event.target.value)}
            />
            <div>
              <Button type="submit" variant="destructive" disabled={confirmKey !== project.key}>
                <Trans>Delete project</Trans>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
