import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import { ErrorMessage } from "../feedback.tsx"
import { TextField } from "../form.tsx"
import { invalidateProject } from "./invalidate.ts"

export function LifecycleSection({ project }: { readonly project: ProjectDetail }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmKey, setConfirmKey] = useState("")
  const archived = project.status === "archived"

  const toggleArchive = useMutation({
    mutationFn: () =>
      callApi((api) =>
        archived
          ? api.projects.unarchive({ params: { projectId: project.id } })
          : api.projects.archive({ params: { projectId: project.id } }),
      ),
    onSuccess: () => invalidateProject(queryClient, project.id),
  })

  const remove = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.projects.delete({
          params: { projectId: project.id },
          payload: { confirm: project.key },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.projects }),
        queryClient.invalidateQueries({ queryKey: keys.adminProjects }),
      ])
      await navigate({ to: "/" })
    },
  })

  const onDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (confirmKey === project.key) remove.mutate()
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
          {toggleArchive.error !== null && <ErrorMessage error={toggleArchive.error} />}
          <Button
            variant="outline"
            disabled={toggleArchive.isPending}
            onClick={() => toggleArchive.mutate()}
          >
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
            {remove.error !== null && <ErrorMessage error={remove.error} />}
            <div>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirmKey !== project.key || remove.isPending}
              >
                <Trans>Delete project</Trans>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
