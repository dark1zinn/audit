import { describe, expect, test } from "bun:test"
import { RichDocError, isValidRichDoc, sanitizeRichDoc } from "../src/sanitize.ts"

const ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b"
const doc = (...content: unknown[]) => ({ type: "doc", content })
const para = (...content: unknown[]) => ({ type: "paragraph", content })
const text = (value: string, marks?: unknown[]) =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks }

describe("sanitizeRichDoc", () => {
  test("keeps a well-formed document", () => {
    const input = doc(
      para(
        text("hello "),
        text("link", [{ type: "link", attrs: { href: "https://example.test/a" } }]),
        { type: "mention", attrs: { id: ID, type: "user", label: "Ada" } },
      ),
    )
    expect(sanitizeRichDoc(input)).toEqual(input as never)
  })

  test("refuses a javascript: link", () => {
    const input = doc(para(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))
    expect(() => sanitizeRichDoc(input)).toThrow(RichDocError)
  })

  test("refuses an image that is not a stored file", () => {
    expect(() =>
      sanitizeRichDoc(doc({ type: "image", attrs: { src: "https://evil.test/p.png" } })),
    ).toThrow(RichDocError)
    expect(() =>
      sanitizeRichDoc(doc({ type: "image", attrs: { src: "/files/../../etc/passwd" } })),
    ).toThrow(RichDocError)
  })

  test("refuses an unknown node or mark type", () => {
    expect(() => sanitizeRichDoc(doc({ type: "rawHtml", attrs: {} }))).toThrow(RichDocError)
    expect(() => sanitizeRichDoc(doc(para(text("x", [{ type: "script" }]))))).toThrow(RichDocError)
  })

  test("refuses a mention with a non-id or unknown type", () => {
    expect(() =>
      sanitizeRichDoc(doc(para({ type: "mention", attrs: { id: "nope", type: "user" } }))),
    ).toThrow(RichDocError)
    expect(() =>
      sanitizeRichDoc(doc(para({ type: "mention", attrs: { id: ID, type: "secret" } }))),
    ).toThrow(RichDocError)
  })

  test("accepts @channel and @here only as matching broadcast id and type", () => {
    for (const name of ["channel", "here"]) {
      const mention = { type: "mention", attrs: { id: name, type: name, label: name } }
      expect(sanitizeRichDoc(doc(para(mention)))).toEqual(doc(para(mention)) as never)
    }
    expect(() =>
      sanitizeRichDoc(doc(para({ type: "mention", attrs: { id: "here", type: "user" } }))),
    ).toThrow(RichDocError)
    expect(() =>
      sanitizeRichDoc(doc(para({ type: "mention", attrs: { id: "channel", type: "here" } }))),
    ).toThrow(RichDocError)
  })

  test("drops attributes the schema does not define", () => {
    const out = sanitizeRichDoc(
      doc(para({ type: "mention", attrs: { id: ID, type: "user", label: "A", onclick: "x()" } })),
    )
    expect(out).toEqual(
      doc(para({ type: "mention", attrs: { id: ID, type: "user", label: "A" } })) as never,
    )
  })

  test("refuses a document nested beyond the depth limit", () => {
    let node: unknown = para(text("deep"))
    for (let i = 0; i < 40; i += 1) node = { type: "blockquote", content: [node] }
    expect(() => sanitizeRichDoc(doc(node))).toThrow(RichDocError)
  })

  test("refuses a document with a non-doc root", () => {
    expect(isValidRichDoc(para(text("x")))).toBe(false)
    expect(isValidRichDoc("nope")).toBe(false)
  })
})
