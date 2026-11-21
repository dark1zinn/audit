/** WCAG relative luminance of an sRGB colour given as `#rgb` or `#rrggbb`. */
function relativeLuminance(hex: string): number | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (match === null) return undefined
  const digits = match[1] ?? ""
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits
  const value = Number.parseInt(full, 16)
  const linear = (shift: number): number => {
    const channel = ((value >> shift) & 0xff) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0)
}

/**
 * Text colour for a label chip on a user-chosen background. Picks white or black, whichever
 * contrasts more, so the chip stays at or above 4.5:1 for any colour (the best of the two is
 * always at least about 4.58:1). Unparseable colours fall back to white.
 */
export function labelTextColor(background: string): "#ffffff" | "#000000" {
  const luminance = relativeLuminance(background)
  if (luminance === undefined) return "#ffffff"
  const onWhite = 1.05 / (luminance + 0.05)
  const onBlack = (luminance + 0.05) / 0.05
  return onWhite >= onBlack ? "#ffffff" : "#000000"
}
