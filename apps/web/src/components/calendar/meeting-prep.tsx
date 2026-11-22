import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { CalendarId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AiTextDialog, useAiAction } from "../ai/ai-text-dialog.tsx"
import { aiStatusQuery } from "../../lib/ai.ts"
import { ErrorMessage } from "../feedback.tsx"

/** Suggests an agenda for the calendar's meeting; the result is shown as text only. */
export function MeetingPrep({ calendarId }: { readonly calendarId: CalendarId }) {
  const { t } = useLingui()
  const action = useAiAction()
  const status = useQuery(aiStatusQuery)
  const [text, setText] = useState<string | null>(null)

  const current = status.data
  if (current === undefined) return null

  // The same refusals the server applies, shown up front so the button explains itself.
  let block: string | null = null
  if (!current.enabled) block = t`AI is turned off for this workspace.`
  else if (!current.allowed) block = t`Your role cannot use AI in this workspace.`
  else if (!current.features.calendar)
    block = t`AI for the calendar is turned off for this workspace.`
  else if (!current.hasProvider) block = t`No AI provider is configured yet.`
  else if (current.monthlyTokenBudget !== null && current.usedTokens >= current.monthlyTokenBudget)
    block = t`This month's AI budget is used up.`

  return (
    <>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          disabled={block !== null || action.isPending}
          aria-describedby={block === null ? undefined : "meeting-prep-reason"}
          onClick={() =>
            action.mutate(
              { surface: "calendar", action: "suggest_agenda", calendarId },
              { onSuccess: (data) => setText(data.text ?? "") },
            )
          }
        >
          <Sparkles aria-hidden="true" className="size-4" />
          <Trans>Meeting prep</Trans>
        </Button>
        {block === null ? null : (
          <p id="meeting-prep-reason" className="text-xs text-muted-foreground">
            {block}
          </p>
        )}
      </div>
      {action.isError ? <ErrorMessage error={action.error} /> : null}
      {text === null ? null : (
        <AiTextDialog
          open
          onOpenChange={(open) => {
            if (!open) setText(null)
          }}
          title={t`Meeting prep`}
          text={text}
        />
      )}
    </>
  )
}
