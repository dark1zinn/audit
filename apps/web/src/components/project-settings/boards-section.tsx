import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { ProjectId } from "@audit/domain/ids"
import type { Board } from "@audit/domain/projects/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import { callApi } from "../../lib/api.ts"
import { boardsQuery, keys } from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { formValue, TextField } from "../form.tsx"
import { BoardColumns } from "./board-columns.tsx"
import { invalidateBoards } from "./invalidate.ts"

export function BoardsSection({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const boards = useQuery(boardsQuery(projectId))

  const create = useMutation({
    mutationFn: (name: string) =>
      callApi((api) => api.boards.create({ params: { projectId }, payload: { name } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.boards(projectId) }),
  })

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(formValue(event.currentTarget, "board-name").trim())
    event.currentTarget.reset()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Boards</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Boards group the columns and tasks of this project.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {boards.isPending && <LoadingRows />}
        {boards.isError && <ErrorMessage error={boards.error} />}
        {boards.data?.map((board) => (
          <BoardSettings key={`${board.id}:${board.version}`} board={board} />
        ))}
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={onCreate}>
          <TextField name="board-name" label={t`New board name`} required maxLength={120} />
          <Button type="submit" disabled={create.isPending}>
            <Trans>Create board</Trans>
          </Button>
        </form>
        {create.error !== null && <ErrorMessage error={create.error} />}
      </CardContent>
    </Card>
  )
}

function BoardSettings({ board }: { readonly board: Board }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const refresh = () => invalidateBoards(queryClient, board.projectId, board.id)

  const rename = useMutation({
    mutationFn: (name: string) =>
      callApi((api) =>
        api.boards.rename({
          params: { boardId: board.id },
          payload: { name, version: board.version },
        }),
      ),
    onSuccess: refresh,
  })

  const restrict = useMutation({
    mutationFn: (restricted: boolean) =>
      callApi((api) =>
        api.boards.setRestricted({ params: { boardId: board.id }, payload: { restricted } }),
      ),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: () => callApi((api) => api.boards.delete({ params: { boardId: board.id } })),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: keys.projects })])
    },
  })

  const error = rename.error ?? restrict.error ?? remove.error
  const renameField = `board-name-${board.id}`
  const restrictedId = `board-restricted-${board.id}`

  return (
    <section aria-label={board.name} className="space-y-4 rounded-lg border p-4">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          rename.mutate(formValue(event.currentTarget, renameField).trim())
        }}
      >
        <TextField
          name={renameField}
          label={t`Board name`}
          defaultValue={board.name}
          required
          maxLength={120}
        />
        <Button type="submit" variant="outline" disabled={rename.isPending}>
          <Trans>Rename</Trans>
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={restrictedId}
            checked={board.restricted}
            disabled={restrict.isPending}
            onCheckedChange={(restricted) => restrict.mutate(restricted)}
          />
          <Label htmlFor={restrictedId}>
            <Trans>Restricted</Trans>
          </Label>
        </div>
        {confirmingDelete ? (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trans>Confirm delete</Trans>
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            <Trans>Delete board</Trans>
          </Button>
        )}
      </div>

      {error !== null && <ErrorMessage error={error} />}
      <BoardColumns board={board} />
    </section>
  )
}
