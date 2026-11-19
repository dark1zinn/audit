import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { AiProposalId } from "@audit/domain/ids"
import type { TaskDetail } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { ProposalCard } from "../ai/assistant-parts.tsx"
import { useAiAction } from "../ai/ai-text-dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

interface BreakDownResult {
  readonly text: string
  readonly proposals: ReadonlyArray<AiProposalId>
}

/** Splits the task into subtasks. Each one arrives as a proposal, applied only after approval. */
export function BreakDown({ task }: { readonly task: TaskDetail }) {
  const { t } = useLingui()
  const action = useAiAction()
  const [result, setResult] = useState<BreakDownResult | null>(null)

  return (
    <section aria-label={t`Break down`} className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        disabled={action.isPending}
        onClick={() =>
          action.mutate(
            { surface: "board", action: "break_down", boardId: task.boardId, taskId: task.id },
            {
              onSuccess: (data) => setResult({ text: data.text ?? "", proposals: data.proposals }),
            },
          )
        }
      >
        <Sparkles aria-hidden="true" className="size-4" />
        <Trans>Break down</Trans>
      </Button>
      {action.isError ? <ErrorMessage error={action.error} /> : null}
      {result === null ? null : (
        <div className="space-y-3 rounded-lg border p-4">
          {result.text === "" ? null : <p className="text-sm whitespace-pre-wrap">{result.text}</p>}
          {result.proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No subtasks suggested.</Trans>
            </p>
          ) : (
            result.proposals.map((proposalId) => (
              <ProposalCard key={proposalId} proposalId={proposalId} />
            ))
          )}
          <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
            <Trans>Dismiss</Trans>
          </Button>
        </div>
      )}
    </section>
  )
}
