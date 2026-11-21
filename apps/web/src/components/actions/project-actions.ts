import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, Copy, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { ProjectId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import { invalidateProject } from "../project-settings/invalidate.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useGo, useRunAction } from "./shared.ts"

type ProjectTarget = Extract<EntityTarget, { kind: "project" }>

export const useProjectActions = (target: ProjectTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  const queryClient = useQueryClient()
  const run = useRunAction(() =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.projects }),
      queryClient.invalidateQueries({ queryKey: keys.adminProjects }),
    ]),
  )
  if (target === null) return []
  const { project } = target
  const projectId = project.id as ProjectId
  const key = project.key
  const archived = project.status === "archived"
  const deleted = project.status === "deleted"
  const href = `/p/${key}/board`

  const lifecycle: ActionGroup = deleted
    ? [
        {
          id: "restore",
          label: t`Restore`,
          icon: RotateCcw,
          run: () =>
            run.mutate(() => callApi((api) => api.projects.restore({ params: { projectId } })), {
              onSuccess: () => toast.success(t`Project restored`),
            }),
        },
      ]
    : [
        {
          id: "archive",
          label: archived ? t`Unarchive` : t`Archive`,
          icon: archived ? ArchiveRestore : Archive,
          confirm: archived
            ? undefined
            : {
                title: t`Archive “${project.name}”?`,
                description: t`The project becomes read-only.`,
                confirmLabel: t`Archive`,
              },
          run: () =>
            run.mutate(
              () =>
                archived
                  ? callApi((api) => api.projects.unarchive({ params: { projectId } }))
                  : callApi((api) => api.projects.archive({ params: { projectId } })),
              {
                onSuccess: async () => {
                  await invalidateProject(queryClient, projectId)
                  toast.success(archived ? t`Project unarchived` : t`Project archived`)
                },
              },
            ),
        },
        {
          id: "delete",
          label: t`Delete`,
          icon: Trash2,
          variant: "destructive",
          confirm: {
            title: t`Delete “${project.name}”?`,
            description: t`The project and its tasks and docs are removed.`,
            confirmLabel: t`Delete`,
          },
          run: () =>
            run.mutate(
              () =>
                callApi((api) =>
                  api.projects.delete({ params: { projectId }, payload: { confirm: key } }),
                ),
              {
                onSuccess: () => {
                  toast.success(t`Project deleted`)
                  target.onDeleted?.()
                },
              },
            ),
        },
      ]

  return [
    [
      { id: "board", label: t`Board`, run: () => go(`/p/${key}/board`) },
      { id: "list", label: t`List`, run: () => go(`/p/${key}/list`) },
      { id: "docs", label: t`Docs`, run: () => go(`/p/${key}/docs`) },
      { id: "calendar", label: t`Calendar`, run: () => go(`/p/${key}/calendar`) },
      { id: "settings", label: t`Settings`, run: () => go(`/p/${key}/settings`) },
    ],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
    ],
    lifecycle,
  ]
}
