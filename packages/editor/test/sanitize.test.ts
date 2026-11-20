import { describe, expect, test } from "bun:test"
import { RICH_DOC_LIMITS, RichDocError, isValidRichDoc, sanitizeRichDoc } from "../src/sanitize.ts"

const ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b"
const FILE = "/files/6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4c"
const doc = (...content: unknown[]) => ({ type: "doc", content })
const para = (...content: unknown[]) => ({ type: "paragraph", content })
const text = (value: string, marks?: unknown[]) =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks }
const link = (href: string) => [{ type: "link", attrs: { href } }]

describe("sanitizeRichDoc", () => {
  test("keeps a well-formed document", () => {
    const input = doc(
      para(text("hello "), text("link", link("https://example.test/a")), {
        type: "mention",
        attrs: { id: ID, type: "user", label: "Ada" },
      }),
    )
    expect(sanitizeRichDoc(input, "message")).toEqual(input as never)
  })

  test("keeps http, https, mailto, tel and relative link destinations", () => {
    for (const href of [
      "https://example.test/a",
      "http://example.test",
      "mailto:ada@example.test",
      "tel:+15550100",
      "/docs/a",
      "docs/a.html",
      "#intro",
    ]) {
      const input = doc(para(text("x", link(href))))
      expect(sanitizeRichDoc(input, "message")).toEqual(input as never)
    }
  })

  test("drops a javascript: link mark and keeps its text", () => {
    const out = sanitizeRichDoc(doc(para(text("x", link("javascript:alert(1)")))), "message")
    expect(out).toEqual(doc(para(text("x"))) as never)
  })

  test("drops a link whose scheme is hidden by control characters or spaces", () => {
    for (const href of ["java\tscript:alert(1)", " javascript:alert(1)", "java\nscript:x"]) {
      const out = sanitizeRichDoc(doc(para(text("x", link(href)))), "message")
      expect(out).toEqual(doc(para(text("x"))) as never)
    }
  })

  test("drops a protocol-relative or backslash link to another host", () => {
    for (const href of ["//evil.test/p", "/\\evil.test", "\\\\evil.test"]) {
      const out = sanitizeRichDoc(doc(para(text("x", link(href)))), "message")
      expect(out).toEqual(doc(para(text("x"))) as never)
    }
  })

  test("drops a link destination beyond the length limit", () => {
    const href = `https://example.test/${"a".repeat(RICH_DOC_LIMITS.href)}`
    const out = sanitizeRichDoc(doc(para(text("x", link(href)))), "message")
    expect(out).toEqual(doc(para(text("x"))) as never)
  })

  test("drops an image that is not a stored file, and keeps the stored one", () => {
    const external = { type: "image", attrs: { src: "https://evil.test/p.png" } }
    expect(sanitizeRichDoc(doc(external, para(text("x"))), "message")).toEqual(
      doc(para(text("x"))) as never,
    )
    const stored = { type: "image", attrs: { src: FILE } }
    expect(sanitizeRichDoc(doc(stored), "message")).toEqual(doc(stored) as never)
  })

  test("fills a container emptied by a dropped image with a paragraph", () => {
    const out = sanitizeRichDoc(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "image", attrs: { src: "https://evil.test/p.png" } }],
          },
        ],
      }),
      "message",
    )
    expect(out).toEqual(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
      }) as never,
    )
  })

  test("refuses an unknown node or mark type", () => {
    expect(() => sanitizeRichDoc(doc({ type: "rawHtml", attrs: {} }), "message")).toThrow(
      RichDocError,
    )
    expect(() => sanitizeRichDoc(doc(para(text("x", [{ type: "script" }]))), "message")).toThrow(
      RichDocError,
    )
  })

  test("refuses a mention with a non-id or unknown type", () => {
    expect(() =>
      sanitizeRichDoc(
        doc(para({ type: "mention", attrs: { id: "nope", type: "user" } })),
        "message",
      ),
    ).toThrow(RichDocError)
    expect(() =>
      sanitizeRichDoc(doc(para({ type: "mention", attrs: { id: ID, type: "secret" } })), "message"),
    ).toThrow(RichDocError)
  })

  test("accepts @channel and @here only as matching broadcast id and type", () => {
    for (const name of ["channel", "here"]) {
      const mention = { type: "mention", attrs: { id: name, type: name, label: name } }
      expect(sanitizeRichDoc(doc(para(mention)), "message")).toEqual(doc(para(mention)) as never)
    }
    expect(() =>
      sanitizeRichDoc(
        doc(para({ type: "mention", attrs: { id: "here", type: "user" } })),
        "message",
      ),
    ).toThrow(RichDocError)
    expect(() =>
      sanitizeRichDoc(
        doc(para({ type: "mention", attrs: { id: "channel", type: "here" } })),
        "message",
      ),
    ).toThrow(RichDocError)
  })

  test("refuses a mention label beyond the label limit", () => {
    const label = "a".repeat(RICH_DOC_LIMITS.mentionLabel + 1)
    expect(() =>
      sanitizeRichDoc(
        doc(para({ type: "mention", attrs: { id: ID, type: "user", label } })),
        "message",
      ),
    ).toThrow(RichDocError)
  })

  test("keeps table column widths given as arrays", () => {
    const cell = {
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: [120, null] },
      content: [para(text("x"))],
    }
    const input = doc({ type: "table", content: [{ type: "tableRow", content: [cell] }] })
    expect(sanitizeRichDoc(input, "doc")).toEqual(input as never)
  })

  test("drops attributes the schema does not define", () => {
    const out = sanitizeRichDoc(
      doc(para({ type: "mention", attrs: { id: ID, type: "user", label: "A", onclick: "x()" } })),
      "message",
    )
    expect(out).toEqual(
      doc(para({ type: "mention", attrs: { id: ID, type: "user", label: "A" } })) as never,
    )
  })

  test("refuses a document nested beyond the depth limit", () => {
    let node: unknown = para(text("deep"))
    for (let i = 0; i < 40; i += 1) node = { type: "blockquote", content: [node] }
    expect(() => sanitizeRichDoc(doc(node), "message")).toThrow(RichDocError)
  })

  test("applies the message size limit to messages and the larger one to documents", () => {
    const big = doc(para(text("x".repeat(RICH_DOC_LIMITS.message.chars))))
    expect(() => sanitizeRichDoc(big, "message")).toThrow(RichDocError)
    expect(() => sanitizeRichDoc(big, "doc")).not.toThrow()
  })

  test("refuses a document with a non-doc root", () => {
    expect(isValidRichDoc(para(text("x")), "doc")).toBe(false)
    expect(isValidRichDoc("nope", "doc")).toBe(false)
  })
})
