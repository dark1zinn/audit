import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import type { ProjectId } from "@audit/domain/ids"
import type { ListTasksQuery, SavedFilter } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { callApi } from "../../lib/api.ts"
import { errorKind } from "../../lib/errors.ts"
import { keys, savedFiltersQuery } from "../../lib/queries.ts"
import { formValue, TextField } from "../form.tsx"

/** Sentinel for "no saved view selected"; Radix Select forbids empty item values. */
const NONE = "none"

export interface SavedFiltersProps {
  readonly projectId: ProjectId
  readonly query: ListTasksQuery
  readonly onApply: (filter: ListTasksQuery) => void
}

export function SavedFilters({ projectId, query, onApply }: SavedFiltersProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const saved = useQuery(savedFiltersQuery(projectId))
  const [selectedId, setSelectedId] = useState(NONE)
  const [dialogOpen, setDialogOpen] = useState(false)
  const selected = saved.data?.find((filter) => filter.id === selectedId)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.savedFilters(projectId) })

  const create = useMutation({
    mutationFn: (name: string) =>
      callApi((api) =>
        api.tasks.createSavedFilter({ params: { projectId }, payload: { name, filter: query } }),
      ),
    onSuccess: async (filter: SavedFilter) => {
      setSelectedId(filter.id)
      setDialogOpen(false)
      await invalidate()
      toast.success(t`View saved.`)
    },
    onError: (error) => {
      toast.error(
        errorKind(error) === "validation"
          ? t`Enter a name up to 80 characters.`
          : t`Could not save the view.`,
      )
    },
  })

  const remove = useMutation({
    mutationFn: (filter: SavedFilter) =>
      callApi((api) => api.tasks.deleteSavedFilter({ params: { filterId: filter.id } })),
    onSuccess: async () => {
      setSelectedId(NONE)
      await invalidate()
      toast.success(t`View deleted.`)
    },
    onError: () => {
      toast.error(t`Could not delete the view.`)
    },
  })

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = formValue(event.currentTarget, "name").trim()
    if (name.length === 0) return
    create.mutate(name)
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedId}
        onValueChange={(id) => {
          setSelectedId(id)
          const filter = saved.data?.find((candidate) => candidate.id === id)
          if (filter !== undefined) onApply(filter.filter)
        }}
      >
        <SelectTrigger aria-label={t`Saved views`} className="min-w-48 max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t`No saved view`}</SelectItem>
          {(saved.data ?? []).map((filter) => (
            <SelectItem key={filter.id} value={filter.id}>
              {filter.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        {t`Save view`}
      </Button>
      {selected === undefined ? null : (
        <Button
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(selected)}
        >
          {t`Delete view`}
        </Button>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t`Save view`}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <TextField name="name" label={t`Name`} maxLength={80} required />
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {t`Save view`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
