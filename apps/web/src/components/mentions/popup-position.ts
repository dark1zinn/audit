import { useLayoutEffect, useRef, useState } from "react"

const GAP = 6
const MARGIN = 8

export interface PopupPlacement {
  readonly top: number
  readonly left: number
  /** Limits the popup height to the space on the chosen side of the anchor. */
  readonly maxHeight: number
}

/**
 * Places a popup under the anchor, flipping above it when the bottom edge would leave the viewport
 * and the space above is larger, and shifting it left so the right edge stays visible.
 */
export const placePopup = (
  anchor: { readonly top: number; readonly bottom: number; readonly left: number },
  popup: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): PopupPlacement => {
  const below = viewport.height - anchor.bottom - GAP - MARGIN
  const above = anchor.top - GAP - MARGIN
  const flip = popup.height > below && above > below
  const top = flip
    ? Math.max(MARGIN, anchor.top - GAP - Math.min(popup.height, above))
    : anchor.bottom + GAP
  const maxHeight = Math.max(0, flip ? above : below)
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, viewport.width - popup.width - MARGIN),
  )
  return { top, left, maxHeight }
}

/**
 * Keeps a caret popup on screen. Measures the rendered popup after each change of the anchor or
 * of the row count, which sets the popup height.
 */
export const usePopupPlacement = (anchor: DOMRect | null, rowCount: number) => {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<PopupPlacement | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (anchor === null || element === null) {
      setPlacement(null)
      return
    }
    const next = placePopup(
      anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPlacement((prev) =>
      prev !== null &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next,
    )
  }, [anchor, rowCount])
  return { ref, placement }
}
