import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { AiProposalId, BoardId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { ProposalCard } from "../ai/assistant-parts.tsx"
import { useAiAction } from "../ai/ai-text-dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

interface TriageResult {
  readonly text: string
  readonly proposals: ReadonlyArray<AiProposalId>
}

/** Backlog triage. Suggested changes arrive as proposals and are applied only after approval. */
export function BoardAiMenu({ boardId }: { readonly boardId: BoardId }) {
  const { t } = useLingui()
  const action = useAiAction()
  const [result, setResult] = useState<TriageResult | null>(null)

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        disabled={action.isPending}
        onClick={() =>
          action.mutate(
            { surface: "board", action: "triage", boardId },
            {
              onSuccess: (data) => setResult({ text: data.text ?? "", proposals: data.proposals }),
            },
          )
        }
      >
        <Sparkles aria-hidden="true" className="size-4" />
        <Trans>Triage backlog</Trans>
      </Button>
      {action.isError ? <ErrorMessage error={action.error} /> : null}
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
          <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
            <Trans>Dismiss</Trans>
          </Button>
        </section>
      )}
    </div>
  )
}
