import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import { useLingui } from "@lingui/react/macro"
import type { EntityId, TaskId } from "@audit/domain/ids"
import {
  Mention as MentionNode,
  TaskEmbed as TaskEmbedNode,
  FileAttachment as FileNode,
} from "@audit/editor/extensions"
import { taskDetailQuery } from "../../lib/queries.ts"
import { entityRefQuery } from "./queries.ts"

const stringAttr = (props: NodeViewProps, name: string): string => {
  const value: unknown = props.node.attrs[name]
  return typeof value === "string" ? value : ""
}

const MentionChip = (props: NodeViewProps) => {
  const { t } = useLingui()
  const id = stringAttr(props, "id") as EntityId
  const fallback = stringAttr(props, "label")
  const { data, isPending } = useQuery(entityRefQuery(id))
  if (isPending) return <NodeViewWrapper as="span">@{fallback}</NodeViewWrapper>
  if (data === null || data === undefined) {
    return (
      <NodeViewWrapper as="span" className="text-muted-foreground">
        {t`@unavailable`}
      </NodeViewWrapper>
    )
  }
  if (data.restricted) {
    return (
      <NodeViewWrapper as="span" className="text-muted-foreground">
        {t`@restricted`}
      </NodeViewWrapper>
    )
  }
  const label = data.title ?? data.key ?? fallback
  const className = data.deleted ? "line-through text-muted-foreground" : "font-medium text-primary"
  const href = data.type === "doc" ? `/docs/${data.id}` : undefined
  return (
    <NodeViewWrapper as="span" className={className}>
      {href === undefined ? `@${label}` : <Link to={href}>@{label}</Link>}
    </NodeViewWrapper>
  )
}

const TaskEmbedView = (props: NodeViewProps) => {
  const { t } = useLingui()
  const taskId = stringAttr(props, "taskId") as TaskId
  const { data, isPending, isError } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: taskId !== "",
  })
  if (isPending)
    return <NodeViewWrapper className="rounded-md border p-3 text-sm">…</NodeViewWrapper>
  if (isError || data === undefined) {
    return (
      <NodeViewWrapper className="rounded-md border p-3 text-sm text-muted-foreground">
        {t`Task unavailable`}
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper className="rounded-md border p-3 text-sm" contentEditable={false}>
      <Link
        to="/p/$key/t/$number"
        params={{ key: data.projectKey, number: data.key.slice(data.key.lastIndexOf("-") + 1) }}
        className="font-medium underline"
      >
        {data.key}
      </Link>{" "}
      {data.title}
      <div className="text-muted-foreground mt-1 text-xs">
        {data.dueAt === null ? t`No due date` : t`Due ${data.dueAt.toLocaleDateString()}`}
      </div>
    </NodeViewWrapper>
  )
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`

const FileAttachmentView = (props: NodeViewProps) => {
  const { t } = useLingui()
  const fileId = stringAttr(props, "fileId")
  const name = stringAttr(props, "name")
  const size = Number(props.node.attrs["size"]) || 0
  return (
    <NodeViewWrapper className="flex items-center gap-2 rounded-md border p-2 text-sm">
      <a href={`/files/${fileId}`} download={name} className="underline">
        {name || t`Attachment`}
      </a>
      <span className="text-muted-foreground text-xs">{formatSize(size)}</span>
    </NodeViewWrapper>
  )
}

/** The base extensions with React node views for the chip-like nodes. */
export const mentionNode = MentionNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: "span" })
  },
})

export const taskEmbedNode = TaskEmbedNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskEmbedView)
  },
})

export const fileAttachmentNode = FileNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})
