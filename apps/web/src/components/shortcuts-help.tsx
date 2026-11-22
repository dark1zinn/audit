import { Trans, useLingui } from "@lingui/react/macro"
import { useEffect, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Kbd, KbdGroup } from "@audit/ui/components/ui/kbd.tsx"
import { modKey } from "../lib/platform.ts"
import {
  setShortcutsHelpOpen,
  toggleShortcutsHelp,
  useShortcutsHelpOpen,
} from "./shortcuts-store.ts"

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Keyboard shortcuts</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Single-key shortcuts work when focus is not in a text field.</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 text-sm">
          <ShortcutGroup heading={t`General`}>
            <ShortcutRow keys={[`${modKey()}+K`]} label={t`Open the command palette`} />
            <ShortcutRow keys={["?"]} label={t`Show this list`} />
            <ShortcutRow keys={[`${modKey()}+\\`]} label={t`Collapse or expand the sidebar`} />
            <ShortcutRow keys={["Shift+F10"]} label={t`Open actions for the focused item`} />
          </ShortcutGroup>
          <ShortcutGroup heading={t`Lists`}>
            <ShortcutRow keys={["j", "k"]} label={t`Move between rows, cards, or inbox items`} />
            <ShortcutRow
              keys={["e"]}
              label={t`Open the selected task; archive the selected inbox item`}
            />
            <ShortcutRow keys={["r"]} label={t`Mark the selected inbox item read or unread`} />
          </ShortcutGroup>
          <ShortcutGroup heading={t`Board`}>
            <ShortcutRow keys={["c"]} label={t`Quick-add a card in the board column`} />
            <ShortcutRow
              keys={["a", "l", "m"]}
              label={t`Assign, label, or move the focused card`}
            />
            <ShortcutRow keys={["x"]} label={t`Select or deselect the focused card`} />
          </ShortcutGroup>
          <ShortcutGroup heading={t`Docs`}>
            <ShortcutRow keys={[`${modKey()}+E`]} label={t`Switch between reading and editing`} />
            <ShortcutRow keys={[`${modKey()}+.`]} label={t`Focus mode`} />
            <ShortcutRow keys={["[["]} label={t`Link to another doc or task`} />
            <ShortcutRow keys={["@"]} label={t`Mention a person`} />
            <ShortcutRow keys={["/"]} label={t`Open editor commands`} />
            <ShortcutRow keys={[`${modKey()}+Alt+W`]} label={t`Close the active tab`} />
            <ShortcutRow keys={["Ctrl+Tab"]} label={t`Next tab`} />
            <ShortcutRow keys={["Shift+Enter"]} label={t`Open the focused doc to the side`} />
          </ShortcutGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutGroup({
  heading,
  children,
}: {
  readonly heading: string
  readonly children: ReactNode
}) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-medium uppercase text-muted-foreground">{heading}</h3>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">{children}</dl>
    </section>
  )
}

function ShortcutRow({
  keys,
  label,
}: {
  readonly keys: ReadonlyArray<string>
  readonly label: string
}) {
  return (
    <>
      <dt>
        <KbdGroup>
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </dt>
      <dd>{label}</dd>
    </>
  )
}
