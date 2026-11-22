import type { ReactNode } from "react"
import { useLingui } from "@lingui/react/macro"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@audit/ui/components/ui/alert-dialog.tsx"

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly pending?: boolean
  readonly confirmDisabled?: boolean
  /** Extra content rendered between the description and the footer. */
  readonly children?: ReactNode
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}

/** Shared confirm for every destructive action. The text names the item. */
export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  confirmDisabled = false,
  children,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) => {
  const { t } = useLingui()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive-solid"
            disabled={pending || confirmDisabled}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
