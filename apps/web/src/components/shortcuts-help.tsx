import { Trans, useLingui } from "@lingui/react/macro"
import { useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import {
  setShortcutsHelpOpen,
  toggleShortcutsHelp,
  useShortcutsHelpOpen,
} from "./shortcuts-store.ts"

const Key = ({ children }: { readonly children: string }) => (
  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</kbd>
)

/** Global `?` dialog listing shortcuts. Ignored while typing or inside other dialogs/menus. */
export function ShortcutsHelp() {
  const { t } = useLingui()
  const open = useShortcutsHelpOpen()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== "?") return
      const target = event.target
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.closest('[role="dialog"], [role="listbox"], [role="menu"]') !== null)
      if (editable) return
      event.preventDefault()
      toggleShortcutsHelp()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setShortcutsHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Keyboard shortcuts</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Single-key shortcuts work when focus is not in a text field.</Trans>
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt>
            <Key>{t`Ctrl+K`}</Key>
          </dt>
          <dd>
            <Trans>Open the command palette</Trans>
          </dd>
          <dt>
            <Key>?</Key>
          </dt>
          <dd>
            <Trans>Show this list</Trans>
          </dd>
          <dt>
            <Key>j</Key> / <Key>k</Key>
          </dt>
          <dd>
            <Trans>Move between rows, cards, or inbox items</Trans>
          </dd>
          <dt>
            <Key>e</Key>
          </dt>
          <dd>
            <Trans>Open the selected task; archive the selected inbox item</Trans>
          </dd>
          <dt>
            <Key>r</Key>
          </dt>
          <dd>
            <Trans>Mark the selected inbox item read or unread</Trans>
          </dd>
          <dt>
            <Key>c</Key>
          </dt>
          <dd>
            <Trans>Quick-add a card in the board column</Trans>
          </dd>
          <dt>
            <Key>a</Key> <Key>l</Key> <Key>m</Key>
          </dt>
          <dd>
            <Trans>Assign, label, or move the focused card</Trans>
          </dd>
          <dt>
            <Key>x</Key>
          </dt>
          <dd>
            <Trans>Select or deselect the focused card</Trans>
          </dd>
        </dl>
      </DialogContent>
    </Dialog>
  )
}
