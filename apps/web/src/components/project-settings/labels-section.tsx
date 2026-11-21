import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { ProjectId } from "@audit/domain/ids"
import type { Label as ProjectLabel } from "@audit/domain/projects/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { callApi } from "../../lib/api.ts"
import { keys, labelsQuery } from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { TextField } from "../form.tsx"

const DEFAULT_COLOR = "#6b7280"

export function LabelsSection({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const labels = useQuery(labelsQuery(projectId))
  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_COLOR)

  const create = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.boards.createLabel({
          params: { projectId },
          payload: { name: name.trim(), color },
        }),
      ),
    onSuccess: async () => {
      setName("")
      setColor(DEFAULT_COLOR)
      await queryClient.invalidateQueries({ queryKey: keys.labels(projectId) })
    },
  })

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Labels</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Labels classify tasks across the boards of this project.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {labels.isPending && <LoadingRows />}
        {labels.isError && <ErrorMessage error={labels.error} />}
        {labels.data !== undefined && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Name</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Color</Trans>
                </TableHead>
                <TableHead>
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.data.map((label) => (
                <LabelRow key={`${label.id}:${label.name}:${label.color}`} label={label} />
              ))}
            </TableBody>
          </Table>
        )}

        <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" onSubmit={onCreate}>
          <TextField
            name="label-name"
            width="md"
            label={t`New label name`}
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="space-y-2">
            <Label htmlFor="label-color">
              <Trans>Color</Trans>
            </Label>
            <Input
              id="label-color"
              type="color"
              className="h-9 w-16 cursor-pointer p-1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
            <Trans>Add label</Trans>
          </Button>
        </form>
        {create.error !== null && <ErrorMessage error={create.error} />}
      </CardContent>
    </Card>
  )
}

function LabelRow({ label }: { readonly label: ProjectLabel }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [name, setName] = useState(label.name)
  const [color, setColor] = useState(label.color)

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.labels(label.projectId) })

  const update = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.boards.updateLabel({
          params: { labelId: label.id },
          payload: { name: name.trim(), color },
        }),
      ),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: () => callApi((api) => api.boards.deleteLabel({ params: { labelId: label.id } })),
    onSuccess: refresh,
  })

  const error = update.error ?? remove.error
  const busy = update.isPending || remove.isPending

  return (
    <>
      <TableRow>
        <TableCell>
          <Input
            aria-label={t`Label name`}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </TableCell>
        <TableCell>
          <Input
            type="color"
            aria-label={t`Label color`}
            className="h-9 w-16 cursor-pointer p-1"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => update.mutate()}>
              <Trans>Save</Trans>
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => remove.mutate()}>
              <Trans>Delete</Trans>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {error !== null && (
        <TableRow>
          <TableCell colSpan={3}>
            <ErrorMessage error={error} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
