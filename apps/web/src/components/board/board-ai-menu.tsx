import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { AiProposalId, BoardId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { ProposalCard } from "../ai/assistant-parts.tsx"
import { useAiAction } from "../ai/ai-text-dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

export interface TriageResult {
  readonly text: string
  readonly proposals: ReadonlyArray<AiProposalId>
}

export interface TriageState {
  readonly pending: boolean
  readonly error: unknown
  readonly isError: boolean
  readonly result: TriageResult | null
  readonly run: () => void
  readonly dismiss: () => void
}

/** Backlog triage state, shared by the toolbar button and the result panel. */
export function useTriage(boardId: BoardId): TriageState {
  const action = useAiAction()
  const [result, setResult] = useState<TriageResult | null>(null)
  return {
    pending: action.isPending,
    error: action.error,
    isError: action.isError,
    result,
    run: () =>
      action.mutate(
        { surface: "board", action: "triage", boardId },
        {
          onSuccess: (data) => setResult({ text: data.text ?? "", proposals: data.proposals }),
        },
      ),
    dismiss: () => setResult(null),
  }
}

/** Toolbar trigger. Suggested changes arrive as proposals and are applied only after approval. */
export function TriageButton({ triage }: { readonly triage: TriageState }) {
  return (
    <Button variant="outline" size="sm" disabled={triage.pending} onClick={triage.run}>
      <Sparkles aria-hidden="true" className="size-4" />
      <Trans>Triage backlog</Trans>
    </Button>
  )
}

/** Result panel, rendered in its own row below the toolbar. Renders nothing when idle. */
export function TriageResultPanel({ triage }: { readonly triage: TriageState }) {
  const { t } = useLingui()
  const { result } = triage
  if (!triage.isError && result === null) return null
  return (
    <div className="space-y-3">
      {triage.isError ? <ErrorMessage error={triage.error} /> : null}
      {result === null ? null : (
        <section aria-label={t`Backlog triage`} className="space-y-3 rounded-lg border p-4">
          {result.text === "" ? null : <p className="text-sm whitespace-pre-wrap">{result.text}</p>}
          {result.proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No changes suggested.</Trans>
            </p>
          ) : (
            result.proposals.map((proposalId) => (
              <ProposalCard key={proposalId} proposalId={proposalId} />
            ))
          )}
          <Button variant="ghost" size="sm" onClick={triage.dismiss}>
            <Trans>Dismiss</Trans>
          </Button>
        </section>
      )}
    </div>
  )
}
