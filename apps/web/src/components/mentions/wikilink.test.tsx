import "../../../test/dom.ts"
import { describe, expect, test } from "bun:test"
import { Editor, type JSONContent } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import type { EntityId } from "@audit/domain/ids"
import { Mention } from "@audit/editor/extensions"
import { MentionPicker, WikilinkPicker, type MentionTrigger } from "./mention-picker.ts"

const docId = "00000000-0000-4000-8000-000000000003" as EntityId

/** An editor with one picker extension; `triggers` records every trigger report, `null` included. */
const makeEditor = (extension: typeof WikilinkPicker) => {
  const triggers: Array<MentionTrigger | null> = []
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit,
      Mention,
      extension.configure({
        onTrigger: (trigger) => triggers.push(trigger),
        onKeyDown: () => false,
      }),
    ],
    content: "<p></p>",
  })
  const open = () => triggers.filter((entry): entry is MentionTrigger => entry !== null).at(-1)
  return { editor, triggers, open }
}

const mentionsOf = (json: JSONContent) => {
  const found: Array<JSONContent> = []
  const walk = (node: JSONContent) => {
    if (node.type === "mention") found.push(node)
    node.content?.forEach(walk)
  }
  walk(json)
  return found
}

describe("WikilinkPicker", () => {
  test("typing [[Rel reports the query Rel", () => {
    const { editor, open } = makeEditor(WikilinkPicker)
    editor.commands.insertContent("[[Rel")
    expect(open()?.query).toBe("Rel")
    editor.destroy()
  })

  test("a query may contain spaces", () => {
    const { editor, open } = makeEditor(WikilinkPicker)
    editor.commands.insertContent("[[Road map")
    expect(open()?.query).toBe("Road map")
    editor.destroy()
  })

  test("typing ]] after the query closes the picker", () => {
    const { editor, open, triggers } = makeEditor(WikilinkPicker)
    editor.commands.insertContent("[[Rel")
    expect(open()?.query).toBe("Rel")
    editor.commands.insertContent("]]")
    expect(triggers.at(-1)).toBeNull()
    editor.destroy()
  })

  test("inserting an item writes a doc mention over the typed [[ text", () => {
    const { editor, open } = makeEditor(WikilinkPicker)
    editor.commands.insertContent("See [[Rel")
    open()?.insert({ id: docId, type: "doc", label: "Roadmap" })
    const json = editor.getJSON()
    expect(mentionsOf(json)).toEqual([
      { type: "mention", attrs: { id: docId, type: "doc", label: "Roadmap" } },
    ])
    expect(editor.getText()).not.toContain("[[")
    editor.destroy()
  })

  test("a single @ does not open the wikilink picker", () => {
    const { editor, triggers } = makeEditor(WikilinkPicker)
    editor.commands.insertContent("@Rel")
    expect(triggers).toEqual([])
    editor.destroy()
  })
})

describe("MentionPicker", () => {
  test("@ still opens the mention picker with the typed query", () => {
    const { editor, open } = makeEditor(MentionPicker)
    editor.commands.insertContent("hi @Ro")
    expect(open()?.query).toBe("Ro")
    editor.destroy()
  })

  test("[[ does not open the mention picker", () => {
    const { editor, triggers } = makeEditor(MentionPicker)
    editor.commands.insertContent("[[Rel")
    expect(triggers).toEqual([])
    editor.destroy()
  })
})
