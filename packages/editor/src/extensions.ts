/**
 * The Tiptap extensions shared by the web editor and the server. Headless-safe: nothing here needs
 * a DOM, so the server builds the schema and transforms Yjs state with the same list.
 *
 * `undoRedo` is off: the collaborative editor undoes through `Y.UndoManager` instead.
 */
import { Node, mergeAttributes } from "@tiptap/core"
import Image from "@tiptap/extension-image"
import { TableKit } from "@tiptap/extension-table"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import StarterKit from "@tiptap/starter-kit"

/** A user, team, task, doc, message, event or project, referenced inline by id. */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null },
      type: { default: "user" },
      label: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const label = typeof node.attrs.label === "string" ? node.attrs.label : String(node.attrs.id)
    return ["span", mergeAttributes(HTMLAttributes, { "data-mention": "" }), `@${label}`]
  },
  renderText({ node }) {
    const label = typeof node.attrs.label === "string" ? node.attrs.label : String(node.attrs.id)
    return `@${label}`
  },
})

/** A live embed of a task: status, assignee and due date are read from the task. */
export const TaskEmbed = Node.create({
  name: "taskEmbed",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { taskId: { default: null } }
  },
  parseHTML() {
    return [{ tag: "div[data-task-embed]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-task-embed": "" }),
      `task ${node.attrs.taskId}`,
    ]
  },
})

/** A file attached to the doc; the bytes are served by `/files/<id>`. */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      fileId: { default: null },
      name: { default: "" },
      size: { default: 0 },
    }
  },
  parseHTML() {
    return [{ tag: "div[data-file-attachment]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-file-attachment": "" }),
      String(node.attrs.name),
    ]
  },
})

export const CALLOUT_TYPES = ["info", "warning", "success", "danger"] as const
export type CalloutType = (typeof CALLOUT_TYPES)[number]

/** A highlighted block of content with a kind that sets its colour. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-type") ?? "info",
      },
    }
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { "data-callout": "", "data-type": node.attrs.type }),
      0,
    ]
  },
})

/** Images may only show stored files served by the files route; the server sanitiser enforces it too. */
export const STORED_FILE_SRC =
  /^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pasted or dropped HTML keeps only images of stored files; others are dropped on parse. */
const StoredImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) =>
          STORED_FILE_SRC.test(element.getAttribute("src") ?? "") ? null : false,
      },
    ]
  },
})

export const extensions = [
  StarterKit.configure({ undoRedo: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  StoredImage,
  Mention,
  TaskEmbed,
  FileAttachment,
  Callout,
]
