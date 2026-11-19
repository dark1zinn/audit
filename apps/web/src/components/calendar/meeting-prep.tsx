import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { CalendarId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AiTextDialog, useAiAction } from "../ai/ai-text-dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

/** Suggests an agenda for the calendar's meeting; the result is shown as text only. */
export function MeetingPrep({ calendarId }: { readonly calendarId: CalendarId }) {
  const { t } = useLingui()
  const action = useAiAction()
  const [text, setText] = useState<string | null>(null)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={action.isPending}
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
