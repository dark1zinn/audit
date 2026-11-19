import { describe, expect, test } from "bun:test"
import { type JsonNode } from "../src/json.ts"
import { extractMentions } from "../src/mentions.ts"
import { jsonToHtml } from "../src/html.ts"
import { jsonToMarkdown, markdownToJson } from "../src/markdown.ts"
import { schema } from "../src/schema.ts"
import { TEMPLATES } from "../src/templates.ts"
import { jsonToText } from "../src/text.ts"
import { EMPTY_DOC, jsonToState, stateToJson } from "../src/ydoc.ts"

const sample: JsonNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hi " },
        { type: "mention", attrs: { id: "u-1", type: "user", label: "Ada" } },
        { type: "text", text: " see this" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
        },
      ],
    },
  ],
}

describe("schema", () => {
  test("headless schema has the shared nodes and no undo/redo", () => {
    for (const name of [
      "paragraph",
      "heading",
      "mention",
      "taskEmbed",
      "fileAttachment",
      "callout",
      "table",
      "image",
      "taskList",
    ]) {
      expect(schema.nodes[name]).toBeDefined()
    }
    expect(schema.nodes.mention!.isInline).toBe(true)
    expect(schema.nodes.mention!.isAtom).toBe(true)
  })
})

describe("text", () => {
  test("blocks are separated and mentions read as @label", () => {
    expect(jsonToText(sample)).toBe("Plan Hi @Ada see this one")
  })

  test("null and empty documents give empty text", () => {
    expect(jsonToText(null)).toBe("")
    expect(jsonToText(EMPTY_DOC)).toBe("")
  })
})

describe("mentions", () => {
  test("extracts distinct mentions with the block text as snippet", () => {
    const found = extractMentions(sample)
    expect(found).toEqual([{ id: "u-1", type: "user", snippet: "Hi @Ada see this" }])
  })

  test("duplicates collapse and non-mention input yields nothing", () => {
    const twice: JsonNode = {
      type: "doc",
      content: [sample.content![1]!, sample.content![1]!],
    }
    expect(extractMentions(twice)).toHaveLength(1)
    expect(extractMentions("nope")).toEqual([])
  })

  test("snippets are capped at 140 characters", () => {
    const long = "x".repeat(300)
    const json: JsonNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: long },
            { type: "mention", attrs: { id: "d-1", type: "doc" } },
          ],
        },
      ],
    }
    expect(extractMentions(json)[0]!.snippet.length).toBe(140)
  })
})

describe("ydoc", () => {
  test("JSON survives a Yjs state round trip", () => {
    const state = jsonToState(sample)
    expect(stateToJson(state)).toEqual(sample)
  })

  test("missing state gives the empty document", () => {
    expect(stateToJson(null)).toEqual(EMPTY_DOC)
    expect(stateToJson(new Uint8Array())).toEqual(EMPTY_DOC)
  })
})

describe("markdown", () => {
  test("parses headings, lists, code, quotes, rules and marks", () => {
    const md = [
      "# Title",
      "",
      "Some **bold** and *italic* and `code`.",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "- [x] done",
      "- [ ] todo",
      "",
      "```ts",
      "const a = 1",
      "```",
      "",
      "> quoted",
      "",
      "---",
    ].join("\n")
    const json = markdownToJson(md)
    const types = json.content!.map((node) => node.type)
    expect(types).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "codeBlock",
      "blockquote",
      "horizontalRule",
    ])
    const paragraph = json.content![1]!
    expect(paragraph.content!.map((node) => node.marks?.[0]?.type)).toEqual([
      undefined,
      "bold",
      undefined,
      "italic",
      undefined,
      "code",
      undefined,
    ])
  })

  test("callouts, tables and images are recognised", () => {
    const md = [
      "> [!warning]",
      "> Careful",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "![cat](/files/f1)",
    ].join("\n")
    const json = markdownToJson(md)
    expect(json.content!.map((node) => node.type)).toEqual(["callout", "table", "image"])
    expect(json.content![0]!.attrs).toEqual({ type: "warning" })
    expect(json.content![2]!.attrs).toEqual({ src: "/files/f1", alt: "cat" })
  })

  test("export and re-import keep the structure", () => {
    const md = jsonToMarkdown(sample)
    expect(md).toBe("# Plan\n\nHi @Ada see this\n\n- one\n")
    expect(markdownToJson(md).content!.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
    ])
  })

  test("empty input gives one empty paragraph", () => {
    expect(markdownToJson("   \n")).toEqual({ type: "doc", content: [{ type: "paragraph" }] })
  })
})

describe("html", () => {
  test("escapes text and renders marks", () => {
    const html = jsonToHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<b>&", marks: [{ type: "bold" }] }],
        },
      ],
    })
    expect(html).toBe("<p><strong>&lt;b&gt;&amp;</strong></p>")
  })

  test("task items carry their checked state", () => {
    const html = jsonToHtml({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
          ],
        },
      ],
    })
    expect(html).toContain('data-type="taskItem" checked')
  })
})

describe("templates", () => {
  test("every template is a valid document with unique ids", () => {
    const ids = new Set(TEMPLATES.map((template) => template.id))
    expect(ids.size).toBe(TEMPLATES.length)
    for (const template of TEMPLATES) {
      expect(template.content.type).toBe("doc")
      expect(template.content.content!.length).toBeGreaterThan(0)
    }
  })
})
