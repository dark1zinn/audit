import { describe, expect, test } from "bun:test"
import { placePopup } from "./popup-position.ts"

const viewport = { width: 1000, height: 900 }
const popup = { width: 320, height: 300 }

describe("placePopup", () => {
  test("opens below the caret when there is room", () => {
    const placement = placePopup({ top: 100, bottom: 120, left: 200 }, popup, viewport)
    expect(placement).toEqual({ top: 126, left: 200, maxHeight: 900 - 120 - 6 - 8 })
  })

  test("flips above the caret when the bottom edge would leave the viewport", () => {
    const placement = placePopup({ top: 840, bottom: 860, left: 200 }, popup, viewport)
    expect(placement.top).toBe(840 - 6 - 300)
    expect(placement.top + popup.height).toBeLessThanOrEqual(840 - 6)
  })

  test("keeps the popup below when neither side fits better", () => {
    const placement = placePopup({ top: 20, bottom: 40, left: 200 }, popup, viewport)
    expect(placement.top).toBe(46)
  })

  test("shifts left so the right edge stays inside the viewport", () => {
    const placement = placePopup({ top: 100, bottom: 120, left: 990 }, popup, viewport)
    expect(placement.left).toBe(1000 - 320 - 8)
  })
})
