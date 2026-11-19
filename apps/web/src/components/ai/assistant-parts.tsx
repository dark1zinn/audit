import { Fragment } from "react"
import { Option, Schema } from "effect"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AiMessage, AiPart } from "@audit/domain/ai/schema"
import type { AiProposalId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { callApi } from "../../lib/api.ts"
import { aiKeys, aiPreferencesQuery, aiProposalsQuery } from "../../lib/ai.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"

export interface LiveTool {
  readonly callId: string
  readonly name: string
  readonly input: unknown
  readonly hasOutput: boolean
  readonly output: unknown
}

/** The turn currently streaming, before the conversation is refetched. */
export interface LiveTurn {
  readonly userText: string
  readonly text: string
  readonly tools: ReadonlyArray<LiveTool>
  readonly proposals: ReadonlyArray<AiProposalId>
}

/** Only http(s) and same-origin paths become links; anything else renders as plain text. */
const safeHref = (url: string): string | null => (/^(https?:\/\/|\/(?!\/))/.test(url) ? url : null)

interface Citation {
  readonly key: string
  readonly title: string
  readonly href: string | null
}

const CitationOutput = Schema.Struct({
  citations: Schema.Array(
    Schema.Struct({
      entityId: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      url: Schema.String,
    }),
  ),
})

/** Citations come from retrieval tool outputs shaped `{ citations: [{ entityId, title, url }] }`. */
const citationsOf = (output: unknown): ReadonlyArray<Citation> => {
  const parsed = Schema.decodeUnknownOption(CitationOutput)(output)
  if (Option.isNone(parsed)) return []
  return parsed.value.citations.map((item) => {
    const title = item.title === undefined || item.title === "" ? item.url : item.title
    return { key: item.entityId ?? item.url, title, href: safeHref(item.url) }
  })
}

export function CitationChips({ output }: { readonly output: unknown }) {
  const { t } = useLingui()
  const citations = citationsOf(output)
  if (citations.length === 0) return null
  return (
    <ul aria-label={t`Sources`} className="flex flex-wrap gap-1.5">
      {citations.map((citation) => (
        <li key={citation.key}>
          {citation.href === null ? (
            <span className="inline-flex rounded-full border px-2 py-0.5 text-xs">
              {citation.title}
            </span>
          ) : (
            <a
              href={citation.href}
              className="inline-flex rounded-full border px-2 py-0.5 text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {citation.title}
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ToolCard({
  kind,
  name,
  value,
}: {
  readonly kind: "call" | "result"
  readonly name: string
  readonly value: unknown
}) {
  const { t } = useLingui()
  return (
    <details className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">
        {kind === "call" ? t`Tool: ${name}` : t`Tool result: ${name}`}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto text-xs break-all whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

interface Preview {
  readonly summary: string
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>
  readonly diff: { readonly before: string; readonly after: string } | null
}

const PreviewShape = Schema.Struct({
  summary: Schema.String,
  fields: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  diff: Schema.optional(Schema.Struct({ before: Schema.String, after: Schema.String })),
})

/** Reads the backend proposal preview `{ summary, fields, diff? }`; null when the shape differs. */
const readPreview = (preview: unknown): Preview | null => {
  const parsed = Schema.decodeUnknownOption(PreviewShape)(preview)
  if (Option.isNone(parsed)) return null
  return {
    summary: parsed.value.summary,
    fields: parsed.value.fields,
    diff: parsed.value.diff ?? null,
  }
}

function DiffBlock({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

export function ProposalCard({ proposalId }: { readonly proposalId: AiProposalId }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const proposals = useQuery(aiProposalsQuery)
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decision === "approve"
        ? callApi((api) => api.ai.approveProposal({ params: { proposalId } }))
        : callApi((api) => api.ai.rejectProposal({ params: { proposalId } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.proposals }),
  })

  if (proposals.isPending) return <LoadingRows />
  if (proposals.isError) return <ErrorMessage error={proposals.error} />
  const proposal = proposals.data.find((item) => item.id === proposalId)
  if (proposal === undefined) return null

  const commandLabels: Record<string, string | undefined> = {
    create_task: t`Create task`,
    update_task: t`Update task`,
    move_task: t`Move task`,
    assign_task: t`Assign task`,
    create_doc: t`Create document`,
    propose_doc_edit: t`Edit document`,
    create_event: t`Create event`,
    link_entities: t`Link items`,
    draft_message: t`Draft message`,
  }
  const statusLabels: Record<typeof proposal.status, string> = {
    pending: t`Waiting for approval`,
    approved: t`Approved`,
    rejected: t`Rejected`,
    expired: t`Expired`,
    failed: t`Failed`,
  }
  const command = commandLabels[proposal.command] ?? proposal.command
  const preview = readPreview(proposal.preview)

  return (
    <section aria-label={command} className="space-y-2 rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{command}</h3>
        <Badge variant="secondary">{statusLabels[proposal.status]}</Badge>
      </div>
      {preview === null ? (
        <pre className="max-h-40 overflow-auto text-xs break-all whitespace-pre-wrap">
          {JSON.stringify(proposal.preview, null, 2)}
        </pre>
      ) : (
        <>
          {preview.summary === "" ? null : <p>{preview.summary}</p>}
          {preview.fields.length === 0 ? null : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              {preview.fields.map((field, index) => (
                <Fragment key={index}>
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd className="break-words">{field.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {preview.diff === null ? null : (
            <div className="grid gap-2 md:grid-cols-2">
              <DiffBlock label={t`Before`} text={preview.diff.before} />
              <DiffBlock label={t`After`} text={preview.diff.after} />
            </div>
          )}
        </>
      )}
      {proposal.status === "pending" ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            <Trans>Approve</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate("reject")}
          >
            <Trans>Reject</Trans>
          </Button>
        </div>
      ) : null}
      {decide.isError ? <ErrorMessage error={decide.error} /> : null}
    </section>
  )
}

export function PartView({ part }: { readonly part: AiPart }) {
  switch (part._tag) {
    case "text":
      return <p className="text-sm break-words whitespace-pre-wrap">{part.text}</p>
    case "tool-call":
      return <ToolCard kind="call" name={part.name} value={part.input} />
    case "tool-result":
      return (
        <>
          <ToolCard kind="result" name={part.name} value={part.output} />
          <CitationChips output={part.output} />
        </>
      )
    case "proposal":
      return <ProposalCard proposalId={part.proposalId} />
  }
}

export function MessageView({ message }: { readonly message: AiMessage }) {
  const mine = message.role === "user"
  return (
    <div
      className={
        mine
          ? "ml-auto max-w-[85%] space-y-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground"
          : "max-w-full space-y-2"
      }
    >
      {message.parts.map((part, index) => (
        <PartView key={index} part={part} />
      ))}
    </div>
  )
}

export function LiveTurnView({ live }: { readonly live: LiveTurn }) {
  return (
    <div className="space-y-2" aria-busy="true">
      <p className="sr-only">{live.userText}</p>
      {live.text === "" ? null : (
        <p className="text-sm break-words whitespace-pre-wrap">{live.text}</p>
      )}
      {live.tools.map((tool) => (
        <Fragment key={tool.callId}>
          <ToolCard kind="call" name={tool.name} value={tool.input} />
          {tool.hasOutput ? (
            <>
              <ToolCard kind="result" name={tool.name} value={tool.output} />
              <CitationChips output={tool.output} />
            </>
          ) : null}
        </Fragment>
      ))}
      {live.proposals.map((proposalId) => (
        <ProposalCard key={proposalId} proposalId={proposalId} />
      ))}
      {live.text === "" && live.tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Thinking…</Trans>
        </p>
      ) : null}
    </div>
  )
}

const AUTO_APPROVE_TOOLS = ["draft_message", "link_entities"] as const

/** Auto-approve preferences: tools listed here run without a proposal review. */
export function AutoApproveDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const preferences = useQuery({ ...aiPreferencesQuery, enabled: open })
  const save = useMutation({
    mutationFn: (autoApproveTools: ReadonlyArray<string>) =>
      callApi((api) =>
        api.ai.updatePreferences({ payload: { autoApproveTools: [...autoApproveTools] } }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(aiKeys.preferences, data)
    },
  })
  const labels: Record<(typeof AUTO_APPROVE_TOOLS)[number], string> = {
    draft_message: t`Send drafted messages without review`,
    link_entities: t`Link items without review`,
  }
  const current = preferences.data?.autoApproveTools ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Assistant settings</Trans>
          </DialogTitle>
        </DialogHeader>
        {preferences.isPending ? <LoadingRows /> : null}
        {preferences.isError ? <ErrorMessage error={preferences.error} /> : null}
        {preferences.isSuccess ? (
          <fieldset className="space-y-3" disabled={save.isPending}>
            <legend className="mb-2 text-sm font-medium">
              <Trans>Auto-approve these actions</Trans>
            </legend>
            {AUTO_APPROVE_TOOLS.map((tool) => {
              const id = `auto-approve-${tool}`
              return (
                <div key={tool} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={current.includes(tool)}
                    onCheckedChange={(checked) => {
                      const next = current.filter((name) => name !== tool)
                      save.mutate(checked === true ? [...next, tool] : next)
                    }}
                  />
                  <Label htmlFor={id}>{labels[tool]}</Label>
                </div>
              )
            })}
          </fieldset>
        ) : null}
        {save.isError ? <ErrorMessage error={save.error} /> : null}
      </DialogContent>
    </Dialog>
  )
}
