import { Trans, useLingui } from "@lingui/react/macro"
import { PanelLeft } from "lucide-react"
import { useState } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@audit/ui/components/ui/sheet.tsx"
import { Tooltip, TooltipContent, TooltipTrigger } from "@audit/ui/components/ui/tooltip.tsx"
import { ChatNav } from "./chat-nav.tsx"

/**
 * Stands in for the channel list while a thread is open on a screen narrower than `xl`.
 * The button is the way back: it opens the full list in a sheet over the conversation.
 */
export function ChatListRail({ meId }: { meId: string }) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full flex-col items-center border-e py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Show channel list`}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <PanelLeft className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t`Show channel list`}</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
          <SheetHeader className="border-b">
            <SheetTitle>
              <Trans>Channels</Trans>
            </SheetTitle>
          </SheetHeader>
          {/* Choosing a link navigates; close the sheet so the conversation is visible again. */}
          <div
            className="min-h-0 flex-1 overflow-y-auto p-3"
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest("a") !== null) setOpen(false)
            }}
          >
            <ChatNav meId={meId} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
