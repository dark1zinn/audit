import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import type { ProjectSummary } from "@audit/domain/projects/schema"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { adminProjectsQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/projects")({
  component: AdminProjectsPage,
})

type ProjectAction = "archive" | "unarchive" | "restore" | "delete"

interface PendingAction {
  readonly action: ProjectAction
  readonly project: ProjectSummary
}

function AdminProjectsPage() {
  const { t } = useLingui()
  const projects = useQuery(adminProjectsQuery)
  const [pending, setPending] = useState<PendingAction | null>(null)

  return (
    <>
      <PageHeader
        title={t`Projects`}
        description={t`Every project in the workspace, including archived and deleted ones.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>All projects</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Restricted projects show metadata only. Deleted projects appear only here.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.isPending && <LoadingRows />}
          {projects.isError && <ErrorMessage error={projects.error} />}
          {projects.data !== undefined && (
            <ProjectsTable projects={projects.data} onAction={setPending} />
          )}
        </CardContent>
      </Card>
      {pending !== null && (
        <ProjectActionDialog
          key={`${pending.action}-${pending.project.id}`}
          pending={pending}
          onClose={() => setPending(null)}
        />
      )}
    </>
  )
}

function ProjectsTable({
  projects,
  onAction,
}: {
  readonly projects: ReadonlyArray<ProjectSummary>
  readonly onAction: (pending: PendingAction) => void
}) {
  const { t } = useLingui()

  const statusLabel = (status: ProjectSummary["status"]) => {
    switch (status) {
      case "active":
        return t`Active`
      case "archived":
        return t`Archived`
      case "deleted":
        return t`Deleted`
    }
  }

  const actionLabel = (action: ProjectAction) => {
    switch (action) {
      case "archive":
        return t`Archive`
      case "unarchive":
        return t`Unarchive`
      case "restore":
        return t`Restore`
      case "delete":
        return t`Delete`
    }
  }

  const actionsFor = (status: ProjectSummary["status"]): ProjectAction[] => {
    switch (status) {
      case "active":
        return ["archive", "delete"]
      case "archived":
        return ["unarchive", "delete"]
      case "deleted":
        return ["restore"]
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans>Key</Trans>
          </TableHead>
          <TableHead>
            <Trans>Name</Trans>
          </TableHead>
          <TableHead>
            <Trans>Status</Trans>
          </TableHead>
          <TableHead>
            <Trans>Visibility</Trans>
          </TableHead>
          <TableHead>
            <Trans>Actions</Trans>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-mono">{project.key}</TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2">
                {project.name}
                {project.metadataOnly && (
                  <Badge variant="outline">
                    <Trans>Metadata only</Trans>
                  </Badge>
                )}
              </span>
            </TableCell>
            <TableCell>{statusLabel(project.status)}</TableCell>
            <TableCell>
              {project.visibility === "workspace" ? (
                <Trans>Workspace</Trans>
              ) : (
                <Trans>Restricted</Trans>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {actionsFor(project.status).map((action) => (
                  <Button
                    key={action}
                    variant={action === "delete" ? "destructive" : "outline"}
                    size="sm"
                    aria-label={t`${actionLabel(action)} project ${project.key}`}
                    onClick={() => onAction({ action, project })}
                  >
                    {actionLabel(action)}
                  </Button>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Confirms a lifecycle action. Deleting requires typing the project key. */
function ProjectActionDialog({
  pending,
  onClose,
}: {
  readonly pending: PendingAction
  readonly onClose: () => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { action, project } = pending
  const [typed, setTyped] = useState("")

  const copy = {
    archive: {
      title: t`Archive project ${project.key}?`,
      description: t`Archived projects are read-only until someone unarchives them.`,
      confirm: t`Archive`,
      done: t`Project archived`,
    },
    unarchive: {
      title: t`Unarchive project ${project.key}?`,
      description: t`The project becomes editable again.`,
      confirm: t`Unarchive`,
      done: t`Project unarchived`,
    },
    restore: {
      title: t`Restore project ${project.key}?`,
      description: t`The project and its boards and tasks become visible again.`,
      confirm: t`Restore`,
      done: t`Project restored`,
    },
    delete: {
      title: t`Delete project ${project.key}?`,
      description: t`The project disappears from every list except this page. Type the project key to confirm.`,
      confirm: t`Delete`,
      done: t`Project deleted`,
    },
  }[action]

  const run = useMutation({
    mutationFn: async () => {
      const projectId = project.id
      switch (action) {
        case "archive":
          await callApi((api) => api.projects.archive({ params: { projectId } }))
          break
        case "unarchive":
          await callApi((api) => api.projects.unarchive({ params: { projectId } }))
          break
        case "restore":
          await callApi((api) => api.projects.restore({ params: { projectId } }))
          break
        case "delete":
          await callApi((api) =>
            api.projects.delete({ params: { projectId }, payload: { confirm: project.key } }),
          )
          break
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.adminProjects })
      await queryClient.invalidateQueries({ queryKey: keys.projects })
      toast.success(copy.done)
      onClose()
    },
  })

  const confirmDisabled = run.isPending || (action === "delete" && typed !== project.key)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          id="project-action"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!confirmDisabled) run.mutate()
          }}
        >
          {action === "delete" && (
            <TextField
              name="confirm"
              label={t`Project key`}
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              hint={<span className="font-mono">{project.key}</span>}
            />
          )}
          {run.error !== null && <ErrorMessage error={run.error} />}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="project-action"
            variant={action === "delete" ? "destructive" : "default"}
            disabled={confirmDisabled}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
