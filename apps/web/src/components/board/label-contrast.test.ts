import { describe, expect, test } from "bun:test"
import { labelTextColor } from "./label-contrast.ts"

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const linear = (shift: number): number => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0)
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe("labelTextColor", () => {
  for (const background of ["#6366f1", "#000000", "#fde047", "#ffffff", "#f97316", "#22c55e"]) {
    test(`${background} reaches 4.5:1`, () => {
      expect(ratio(labelTextColor(background), background)).toBeGreaterThanOrEqual(4.5)
    })
  }
  test("unparseable colours fall back to white", () => {
    expect(labelTextColor("red")).toBe("#ffffff")
  })
})
