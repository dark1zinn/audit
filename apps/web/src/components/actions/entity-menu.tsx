import { useState, type ComponentType, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { useLingui } from "@lingui/react/macro"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Spinner } from "@audit/ui/components/ui/spinner.tsx"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@audit/ui/components/ui/context-menu.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { ConfirmDialog } from "./confirm-dialog.tsx"
import { TextField } from "../form.tsx"
import { useEntityActions } from "./use-entity-actions.ts"
import type { ActionGroup, EntityAction, EntityTarget } from "./types.ts"

interface ItemProps {
  readonly children: ReactNode
  readonly disabled: boolean
  readonly variant: "default" | "destructive"
  readonly onSelect: () => void
}

/** Radix primitives of one menu family. Both menus render through `menuItems`. */
interface MenuKit {
  readonly Item: ComponentType<ItemProps>
  readonly Sub: ComponentType<{ readonly children: ReactNode }>
  readonly SubTrigger: ComponentType<{
    readonly children: ReactNode
    readonly disabled?: boolean | undefined
  }>
  readonly SubContent: ComponentType<{ readonly children: ReactNode }>
  readonly Separator: ComponentType
  readonly Shortcut: ComponentType<{ readonly children: ReactNode }>
}

const contextKit: MenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
}

const dropdownKit: MenuKit = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
}

interface MenuRun {
  readonly kit: MenuKit
  readonly request: (action: EntityAction) => void
}

const renderAction = (action: EntityAction, run: MenuRun): ReactNode => {
  const { kit } = run
  const Icon = action.icon
  const icon = Icon ? <Icon aria-hidden /> : null
  if (action.children !== undefined) {
    return (
      <kit.Sub key={action.id}>
        <kit.SubTrigger disabled={action.disabled}>
          {icon}
          {action.label}
        </kit.SubTrigger>
        <kit.SubContent>{menuItems([action.children], run)}</kit.SubContent>
      </kit.Sub>
    )
  }
  const blocked = action.disabled === true || action.pending === true
  return (
    <kit.Item
      key={action.id}
      disabled={blocked}
      variant={action.variant ?? "default"}
      onSelect={() => run.request(action)}
    >
      {action.pending ? <Spinner /> : icon}
      <span className="min-w-0 truncate">{action.label}</span>
      {action.shortcut !== undefined ? <kit.Shortcut>{action.shortcut}</kit.Shortcut> : null}
      {blocked && action.disabledReason !== undefined ? (
        <span className="text-muted-foreground ms-auto ps-4 text-xs">{action.disabledReason}</span>
      ) : null}
    </kit.Item>
  )
}

/** Renders groups in order, separated, so context and dropdown menus show the same data. */
const menuItems = (groups: ReadonlyArray<ActionGroup>, run: MenuRun): ReactNode[] =>
  groups.flatMap((group, index) => {
    const items = group.map((action) => renderAction(action, run))
    return index === 0 ? items : [<run.kit.Separator key={`sep-${index}`} />, ...items]
  })

/**
 * The shared confirm for destructive actions. Its state lives in the wrapper,
 * outside the menu, so it survives the menu closing.
 */
const useConfirmRequest = () => {
  const [pending, setPending] = useState<EntityAction | null>(null)
  const request = (action: EntityAction, run: (action: EntityAction) => void) => {
    if (action.confirm !== undefined) setPending(action)
    else run(action)
  }
  return { pending, setPending, request }
}

const runAction = (action: EntityAction) => action.run?.()

interface ConfirmHostProps {
  readonly pending: EntityAction | null
  readonly onClose: () => void
}

const ConfirmHost = ({ pending, onClose }: ConfirmHostProps) => {
  const { t } = useLingui()
  const confirm = pending?.confirm
  const required = confirm?.typeToConfirm
  const [typed, setTyped] = useState("")
  const [typedFor, setTypedFor] = useState<EntityAction | null>(null)
  if (typedFor !== pending) {
    setTypedFor(pending)
    setTyped("")
  }
  const matches = required === undefined || typed === required
  const submit = () => {
    if (!matches || pending === null) return
    runAction(pending)
    onClose()
  }
  return (
    <ConfirmDialog
      open={pending !== null}
      title={confirm?.title ?? ""}
      description={confirm?.description ?? ""}
      confirmLabel={confirm?.confirmLabel ?? t`Confirm`}
      confirmDisabled={!matches}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onConfirm={submit}
    >
      {required !== undefined && (
        <TextField
          name="confirm-type"
          label={t`Type ${required} to confirm`}
          width="xs"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          }}
        />
      )}
    </ConfirmDialog>
  )
}

export interface EntityContextMenuProps {
  readonly target: EntityTarget
  readonly children: ReactNode
}

/**
 * Right-click menu for an entity. The only place that intercepts `contextmenu`;
 * the browser's native menu stays everywhere else. Radix opens it on Shift+F10
 * and the ContextMenu key as well.
 */
export const EntityContextMenu = ({ target, children }: EntityContextMenuProps) => {
  const [open, setOpen] = useState(false)
  const groups = useEntityActions(target, open)
  const confirm = useConfirmRequest()
  if (groups.length === 0) return <>{children}</>
  const run: MenuRun = {
    kit: contextKit,
    request: (action) => confirm.request(action, runAction),
  }
  return (
    <>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>{menuItems(groups, run)}</ContextMenuContent>
      </ContextMenu>
      <ConfirmHost pending={confirm.pending} onClose={() => confirm.setPending(null)} />
    </>
  )
}

export interface EntityActionsButtonProps {
  readonly target: EntityTarget
  readonly label: string
  /** Button size; compact rows (sidebar) use `icon-sm` so the trigger fits inside the row. */
  readonly size?: "icon" | "icon-sm"
}

/** Visible "…" menu with the same actions as the context menu, for touch and keyboard users. */
export const EntityActionsButton = ({ target, label, size = "icon" }: EntityActionsButtonProps) => {
  const [open, setOpen] = useState(false)
  const groups = useEntityActions(target, open)
  const confirm = useConfirmRequest()
  if (groups.length === 0) return null
  const run: MenuRun = {
    kit: dropdownKit,
    request: (action) => confirm.request(action, runAction),
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size} aria-label={label}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{menuItems(groups, run)}</DropdownMenuContent>
      </DropdownMenu>
      <ConfirmHost pending={confirm.pending} onClose={() => confirm.setPending(null)} />
    </>
  )
}
