import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { Sparkles } from "lucide-react"
import type { ChannelId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { AiTextDialog, useAiAction } from "../ai/ai-text-dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

/** Channel AI actions: summarise shows a preview; draft reply hands the text to the composer. */
export function ChannelAiMenu({
  channelId,
  onDraft,
}: {
  readonly channelId: ChannelId
  readonly onDraft: (text: string) => void
}) {
  const { t } = useLingui()
  const action = useAiAction()
  const [summary, setSummary] = useState<string | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={action.isPending}>
            <Sparkles aria-hidden="true" className="size-4" />
            <Trans>AI</Trans>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              action.mutate(
                { surface: "chat", action: "summarize_channel", channelId },
                { onSuccess: (data) => setSummary(data.text ?? "") },
              )
            }
          >
            <Trans>Summarise unread messages</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              action.mutate(
                { surface: "chat", action: "draft_reply", channelId },
                { onSuccess: (data) => onDraft(data.text ?? "") },
              )
            }
          >
            <Trans>Draft a reply</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {action.isError ? <ErrorMessage error={action.error} /> : null}
      {summary === null ? null : (
        <AiTextDialog
          open
          onOpenChange={(open) => {
            if (!open) setSummary(null)
          }}
          title={t`Channel summary`}
          text={summary}
        />
      )}
    </>
  )
}
