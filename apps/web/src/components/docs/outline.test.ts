import { describe, expect, test } from "bun:test"
import { headingsFromDoc } from "./outline.ts"

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", content: [{ type: "text", text: "hello" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "  Details " }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Deep" }] },
  ],
}

describe("headingsFromDoc", () => {
  test("returns levels, trimmed text and positions", () => {
    expect(headingsFromDoc(doc)).toEqual([
      // "Intro" heading: 2 + 5
      { level: 1, text: "Intro", pos: 0 },
      // + paragraph "hello": 2 + 5 → 14
      { level: 2, text: "Details", pos: 14 },
      // + heading "  Details ": 2 + 10 → 26; bulletList with an empty listItem and paragraph: 2 + (2 + 2) = 6 → Deep at 32
      { level: 3, text: "Deep", pos: 32 },
    ])
  })

  test("returns no headings for an empty doc", () => {
    expect(headingsFromDoc({ type: "doc", content: [] })).toEqual([])
  })
})
