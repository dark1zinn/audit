import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { EntityId } from "@audit/domain/ids"
import { Mention as MentionNode } from "@audit/editor/extensions"
import { EntityChip } from "./entity-chip.tsx"

const stringAttr = (props: NodeViewProps, name: string): string => {
  const value: unknown = props.node.attrs[name]
  return typeof value === "string" ? value : ""
}

const MentionChip = (props: NodeViewProps) => {
  const id = stringAttr(props, "id") as EntityId
  return (
    <NodeViewWrapper as="span" className="inline">
      <EntityChip id={id} type={stringAttr(props, "type")} label={stringAttr(props, "label")} />
    </NodeViewWrapper>
  )
}

/** The shared mention node with a React chip view. */
export const mentionNode = MentionNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: "span" })
  },
})
