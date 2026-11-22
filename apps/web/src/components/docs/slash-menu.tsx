import { useLingui } from "@lingui/react/macro"
import { usePopupPlacement } from "../mentions/popup-position.ts"
import type { SlashState } from "./slash.ts"

/** The `/` command list, anchored under the caret. Keyboard handling lives in the suggestion plugin. */
export const SlashMenu = ({ state }: { readonly state: SlashState }) => {
  const { t } = useLingui()
  const rect = state.rect
  const { ref, placement } = usePopupPlacement(rect, state.items.length)
  if (rect === null) return null
  return (
    <div
      ref={ref}
      aria-label={t`Insert block`}
      className="bg-popover text-popover-foreground fixed z-50 max-h-72 w-64 overflow-auto rounded-md border p-1 shadow-md"
      style={
        placement === null
          ? { top: rect.bottom + 6, left: rect.left }
          : { top: placement.top, left: placement.left, maxHeight: placement.maxHeight }
      }
    >
      {state.items.length === 0 ? (
        <p className="text-muted-foreground p-2 text-sm">{t`No matches`}</p>
      ) : (
        <ul>
          {state.items.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={index === state.index ? "true" : undefined}
                className={`block w-full rounded-sm px-2 py-1.5 text-left text-sm ${
                  index === state.index ? "bg-accent text-accent-foreground" : ""
                }`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  state.select(item)
                }}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
