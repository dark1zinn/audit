import { Fragment, type ReactNode } from "react"
import type { RichDoc } from "@audit/domain/tasks/schema"
import type { EntityId } from "@audit/domain/ids"
import { EntityChip } from "../mentions/entity-chip.tsx"
import { attr, childrenOf, isJsonNode, stringAttr, type JsonNode } from "@audit/editor/json"

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const wrapMarks = (node: JsonNode, content: ReactNode): ReactNode =>
  (node.marks ?? []).reduce<ReactNode>((inner, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{inner}</strong>
      case "italic":
        return <em>{inner}</em>
      case "strike":
        return <s>{inner}</s>
      case "code":
        return <code className="rounded bg-muted px-1 font-mono text-[0.85em]">{inner}</code>
      case "link": {
        const href = stringAttr(mark, "href")
        if (!/^(https?:|mailto:)/i.test(href)) return inner
        return (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {inner}
          </a>
        )
      }
      default:
        return inner
    }
  }, content)

const renderInline = (nodes: ReadonlyArray<JsonNode>, keyPrefix: string): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    if (node.type === "text") {
      return <Fragment key={key}>{wrapMarks(node, node.text ?? "")}</Fragment>
    }
    if (node.type === "hardBreak") return <br key={key} />
    if (node.type === "mention") {
      return (
        <EntityChip
          key={key}
          id={stringAttr(node, "id") as EntityId}
          type={stringAttr(node, "type")}
          label={stringAttr(node, "label", stringAttr(node, "id"))}
        />
      )
    }
    return <Fragment key={key}>{renderInline(childrenOf(node), key)}</Fragment>
  })

const renderChildren = (node: JsonNode, key: string): ReactNode[] =>
  childrenOf(node).map((child, index) => renderBlock(child, `${key}-${index}`))

const renderBlock = (node: JsonNode, key: string): ReactNode => {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className="min-h-[1.5em] whitespace-pre-wrap break-words">
          {renderInline(childrenOf(node), key)}
        </p>
      )
    case "heading":
      return (
        <p key={key} className="font-semibold">
          {renderInline(childrenOf(node), key)}
        </p>
      )
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
          {renderChildren(node, key)}
        </blockquote>
      )
    case "bulletList":
      return (
        <ul key={key} className="ml-5 list-disc">
          {renderChildren(node, key)}
        </ul>
      )
    case "orderedList":
      return (
        <ol key={key} className="ml-5 list-decimal">
          {renderChildren(node, key)}
        </ol>
      )
    case "listItem":
    case "taskItem":
      return <li key={key}>{renderChildren(node, key)}</li>
    case "codeBlock":
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
          <code>
            {childrenOf(node)
              .map((child) => child.text ?? "")
              .join("")}
          </code>
        </pre>
      )
    case "image": {
      const src = stringAttr(node, "src")
      if (!/^\/files\/[0-9a-f-]{36}$/i.test(src)) return null
      return (
        <img
          key={key}
          src={src}
          alt={stringAttr(node, "alt")}
          className="max-h-80 max-w-full rounded-md border"
        />
      )
    }
    case "fileAttachment":
      return (
        <a
          key={key}
          href={`/files/${encodeURIComponent(stringAttr(node, "fileId"))}`}
          className="inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          <span className="truncate">{stringAttr(node, "name", "file")}</span>
          <span className="shrink-0 text-muted-foreground">
            {formatSize(Number(attr(node, "size") ?? 0))}
          </span>
        </a>
      )
    case "horizontalRule":
      return <hr key={key} />
    default:
      return <div key={key}>{renderInline([node], key)}</div>
  }
}

/** Read-only rendering of a chat message body (a ProseMirror JSON document). */
export const MessageBody = ({ body }: { readonly body: RichDoc }) => {
  const root = isJsonNode(body) ? body : null
  if (root === null) return null
  return <div className="space-y-1 text-sm leading-relaxed">{renderChildren(root, "b")}</div>
}
