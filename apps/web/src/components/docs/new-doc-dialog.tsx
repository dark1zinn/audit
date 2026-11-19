import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trans, useLingui } from "@lingui/react/macro"
import type { DocId, EntityId } from "@audit/domain/ids"
import { TEMPLATES } from "@audit/editor/templates"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@audit/ui/components/ui/dialog.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage } from "../feedback.tsx"

interface NewDocDialogProps {
  readonly parentId: EntityId
  readonly hrefFor: (docId: DocId) => string
  /** Changes for each request from elsewhere (for example the command palette); each opens once. */
  readonly requestId?: string | undefined
}

/** Creates a blank or template doc, or imports a Markdown file as a new doc. */
export const NewDocDialog = ({ parentId, hrefFor, requestId }: NewDocDialogProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [template, setTemplate] = useState("blank")
  const [error, setError] = useState<unknown>(null)
  const [handledRequest, setHandledRequest] = useState<string | undefined>(undefined)
  if (requestId !== undefined && requestId !== handledRequest) {
    setHandledRequest(requestId)
    setOpen(true)
  }

  const templateLabels: Record<string, string> = {
    "meeting-notes": t`Meeting notes`,
    rfc: t`RFC`,
    "decision-record": t`Decision record`,
    runbook: t`Runbook`,
    "project-brief": t`Project brief`,
  }

  const finish = async (docId: DocId, search: string | undefined) => {
    await queryClient.invalidateQueries({ queryKey: ["docs"] })
    setOpen(false)
    const href = search
      ? `${hrefFor(docId)}?template=${encodeURIComponent(search)}`
      : hrefFor(docId)
    await navigate({ href })
  }

  const create = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.docs.create({ payload: { parentId, title: title.trim() || t`Untitled` } }),
      ),
    onSuccess: (doc) => {
      setError(null)
      void finish(doc.id, template === "blank" ? undefined : template)
    },
    onError: setError,
  })

  const importMarkdown = useMutation({
    mutationFn: async (file: File) => {
      const markdown = await file.text()
      const name = file.name.replace(/\.(md|markdown)$/i, "")
      return callApi((api) =>
        api.docs.import({
          payload: { parentId, markdown, ...(name === "" ? {} : { title: name }) },
        }),
      )
    },
    onSuccess: (doc) => {
      setError(null)
      void finish(doc.id, undefined)
    },
    onError: setError,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="w-full">
          <Trans>New document</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New document</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Start from a blank page or a template, or import a Markdown file.</Trans>
          </DialogDescription>
        </DialogHeader>
        {error !== null && <ErrorMessage error={error} />}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-doc-title">
              <Trans>Title</Trans>
            </Label>
            <Input
              id="new-doc-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              <Trans>Template</Trans>
            </legend>
            {["blank", ...TEMPLATES.map((item) => item.id)].map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="doc-template"
                  value={id}
                  checked={template === id}
                  onChange={() => setTemplate(id)}
                />
                {id === "blank" ? t`Blank` : templateLabels[id]}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              <Trans>Create</Trans>
            </Button>
          </div>
        </form>
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="import-markdown">
            <Trans>Import Markdown file</Trans>
          </Label>
          <input
            id="import-markdown"
            type="file"
            accept=".md,.markdown,text/markdown"
            className="block text-sm"
            disabled={importMarkdown.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) importMarkdown.mutate(file)
              event.target.value = ""
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
