import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import type { AiActionInput } from "@audit/domain/ai/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { callApi } from "../../lib/api.ts"

/** Runs a one-shot AI action (`POST /api/ai/actions`). Results are read by the caller. */
export const useAiAction = () =>
  useMutation({
    mutationFn: (input: AiActionInput) => callApi((api) => api.ai.action({ payload: input })),
  })

/** Shows generated text with Copy and, when the caller can apply it, Insert. */
export function AiTextDialog({
  open,
  onOpenChange,
  title,
  text,
  onInsert,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly text: string
  readonly onInsert?: ((text: string) => void) | undefined
}) {
  const { t } = useLingui()
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap">
          {text === "" ? <Trans>No result.</Trans> : text}
        </div>
        <output aria-live="polite" className="text-sm text-muted-foreground">
          {status === "copied" ? t`Copied.` : null}
          {status === "failed" ? t`Copy failed. Select the text and copy it manually.` : null}
        </output>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            <Trans>Copy</Trans>
          </Button>
          {onInsert === undefined ? null : (
            <Button
              onClick={() => {
                onInsert(text)
                onOpenChange(false)
              }}
            >
              <Trans>Insert</Trans>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
