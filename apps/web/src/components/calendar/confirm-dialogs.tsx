import { Trans, useLingui } from "@lingui/react/macro"
import type { EventScope } from "@audit/domain/calendar/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { ErrorMessage } from "../feedback.tsx"

/**
 * Asks which occurrences a change applies to. Non-recurring events get a single option so the
 * same prompt also confirms their deletion.
 */
export function ScopeDialog({
  open,
  action,
  recurring,
  pending,
  error,
  onChoose,
  onOpenChange,
}: {
  readonly open: boolean
  readonly action: "edit" | "delete"
  readonly recurring: boolean
  readonly pending: boolean
  readonly error: unknown
  readonly onChoose: (scope: EventScope) => void
  readonly onOpenChange: (open: boolean) => void
}) {
  const { t } = useLingui()
  const scopes: ReadonlyArray<{ scope: EventScope; label: string; hint: string }> = recurring
    ? [
        {
          scope: "this",
          label: action === "delete" ? t`Delete this occurrence` : t`This occurrence`,
          hint: t`Only the occurrence you picked.`,
        },
        {
          scope: "following",
          label: action === "delete" ? t`Delete this and following` : t`This and following`,
          hint: t`The occurrence you picked and every later one.`,
        },
        {
          scope: "all",
          label: action === "delete" ? t`Delete all occurrences` : t`All occurrences`,
          hint: t`The whole series.`,
        },
      ]
    : [
        {
          scope: "all",
          label: action === "delete" ? t`Delete event` : t`Save changes`,
          hint: "",
        },
      ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "delete" ? (
              <Trans>Delete event</Trans>
            ) : (
              <Trans>Edit recurring event</Trans>
            )}
          </DialogTitle>
          <DialogDescription>
            {recurring ? (
              <Trans>Which occurrences should this change apply to?</Trans>
            ) : (
              <Trans>This action cannot be undone.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {scopes.map((option) => (
            <Button
              key={option.scope}
              type="button"
              variant={option.scope === "all" && action === "delete" ? "destructive" : "outline"}
              className="h-auto flex-col items-start gap-0.5 py-2 text-left"
              disabled={pending}
              onClick={() => onChoose(option.scope)}
            >
              <span>{option.label}</span>
              {option.hint !== "" && (
                <span className="text-xs font-normal text-muted-foreground">{option.hint}</span>
              )}
            </Button>
          ))}
        </div>
        {error !== null && error !== undefined && <ErrorMessage error={error} />}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Generic confirmation for destructive actions that have no scope. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onOpenChange,
}: {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly pending: boolean
  readonly error: unknown
  readonly onConfirm: () => void
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error !== null && error !== undefined && <ErrorMessage error={error} />}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
