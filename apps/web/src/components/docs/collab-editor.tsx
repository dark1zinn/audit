import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import * as Y from "yjs"
import type { Editor, JSONContent, Range } from "@tiptap/core"
import type { DocId, TaskId } from "@audit/domain/ids"
import type { ResourceRole } from "@audit/domain/roles"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { callApi } from "../../lib/api.ts"
import { projectsQuery } from "../../lib/queries.ts"
import { uploadFile } from "../../lib/upload.ts"
import { collabExtensions } from "./editor-extensions.ts"
import { SlashCommand, type SlashItem, type SlashState } from "./slash.ts"
import { SlashMenu } from "./slash-menu.tsx"
import { anchorFor, CommentHighlight, type AnchorRange } from "./comments-anchor.ts"
import { findTemplate } from "@audit/editor/templates"
import { MentionShortcuts } from "../mentions/mention-shortcuts.ts"
import { MentionPickerMenu, useMentionPicker } from "../mentions/mention-picker-menu.tsx"

/** Hocuspocus endpoint on the page's own origin; the session cookie authenticates it. */
const collabUrl = () => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}/collab`
}

export interface CollabUser {
  readonly name: string
  readonly color: string
}

/** Viewers and commenters only ever see the document; the server enforces this too. */
const canWrite = (role: ResourceRole) => role === "manager" || role === "editor"

interface Live {
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
}

/** Opens the Hocuspocus connection for one doc; cleaned up on unmount or doc change. */
const useLiveDoc = (docId: DocId, user: CollabUser, onFailed: () => void): Live | null => {
  const [live, setLive] = useState<Live | null>(null)
  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: `doc:${docId}`,
      document: ydoc,
      onAuthenticationFailed: onFailed,
    })
    setLive({ ydoc, provider })
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
    // user is stable for the component's lifetime; onFailed is a callback from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])
  return live
}

interface DocEditorProps {
  readonly docId: DocId
  readonly projectId: string | null
  readonly role: ResourceRole
  readonly user: CollabUser
  readonly comments: ReadonlyArray<AnchorRange>
  readonly onSelectionComment?: (
    anchor: { readonly from: string; readonly to: string },
    quote: string,
  ) => void
  readonly template?: string | undefined
  /** Lets the surrounding page act on the live editor (AI insert, selection reads). */
  readonly editorRef?: { current: Editor | null } | undefined
}

/** The live editor. Mounted only after its provider exists so the editor never starts empty. */
export const DocEditor = (props: DocEditorProps) => {
  const [failed, setFailed] = useState(false)
  const live = useLiveDoc(props.docId, props.user, () => setFailed(true))
  if (failed)
    return (
      <p role="alert" className="text-destructive text-sm">
        <Trans>You cannot open this document.</Trans>
      </p>
    )
  if (live === null) return <div className="text-muted-foreground p-4 text-sm">…</div>
  return <LiveEditor {...props} ydoc={live.ydoc} provider={live.provider} />
}

const LiveEditor = (
  props: DocEditorProps & { readonly ydoc: Y.Doc; readonly provider: HocuspocusProvider },
) => {
  const { t } = useLingui()
  const [scope, setScope] = useState<"read-write" | "readonly" | undefined>(undefined)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [taskDialog, setTaskDialog] = useState<{ range: Range } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const imageInput = useRef<HTMLInputElement | null>(null)
  const pendingFile = useRef<{ range: Range; accept: "image" | "file" } | null>(null)
  const internalEditorRef = useRef<Editor | null>(null)
  const editorRef = props.editorRef ?? internalEditorRef
  const { provider, ydoc, docId, role, user } = props
  const writable = canWrite(role) && scope !== "readonly"

  useEffect(() => {
    const onAuth = ({ scope: next }: { scope: "read-write" | "readonly" }) => setScope(next)
    provider.on("authenticated", onAuth)
    return () => {
      provider.off("authenticated", onAuth)
    }
  }, [provider])

  const insertFile = async (editor: Editor, range: Range, file: File, accept: "image" | "file") => {
    try {
      const ref = await uploadFile(file, docId)
      const chain = editor.chain().focus().deleteRange(range)
      if (accept === "image" || ref.mime.startsWith("image/")) {
        chain.setImage({ src: ref.url, alt: ref.name }).run()
      } else {
        chain
          .insertContent({
            type: "fileAttachment",
            attrs: { fileId: ref.id, name: ref.name, size: ref.size },
          })
          .run()
      }
      setError(null)
    } catch {
      setError(t`The file could not be uploaded.`)
    }
  }

  const items: ReadonlyArray<SlashItem> = [
    {
      key: "h1",
      title: t`Heading 1`,
      keywords: ["h1", "title"],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
    },
    {
      key: "h2",
      title: t`Heading 2`,
      keywords: ["h2"],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
    },
    {
      key: "h3",
      title: t`Heading 3`,
      keywords: ["h3"],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
    },
    {
      key: "bullets",
      title: t`Bulleted list`,
      keywords: ["ul", "list"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      key: "numbers",
      title: t`Numbered list`,
      keywords: ["ol", "ordered"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      key: "tasks",
      title: t`Checklist`,
      keywords: ["todo", "check"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      key: "quote",
      title: t`Quote`,
      keywords: ["blockquote"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      key: "code",
      title: t`Code block`,
      keywords: ["pre", "snippet"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      key: "divider",
      title: t`Divider`,
      keywords: ["hr", "line"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      key: "table",
      title: t`Table`,
      keywords: ["grid"],
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      key: "callout",
      title: t`Callout`,
      keywords: ["note", "info", "warning"],
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "callout",
            attrs: { type: "info" },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      key: "image",
      title: t`Image`,
      keywords: ["picture", "upload"],
      run: (_editor, range) => {
        pendingFile.current = { range, accept: "image" }
        imageInput.current?.click()
      },
    },
    {
      key: "file",
      title: t`File attachment`,
      keywords: ["upload", "attach"],
      run: (_editor, range) => {
        pendingFile.current = { range, accept: "file" }
        fileInput.current?.click()
      },
    },
    {
      key: "task",
      title: t`Embed task`,
      keywords: ["ticket", "issue"],
      run: (_editor, range) => setTaskDialog({ range }),
    },
  ]

  const picker = useMentionPicker()
  const editor = useEditor(
    {
      extensions: [
        ...collabExtensions(ydoc, provider, user),
        picker.extension,
        MentionShortcuts,
        SlashCommand.configure({
          onState: setSlash,
        }),
        CommentHighlight.configure({ getAnchors: () => props.comments }),
      ],
      editable: writable,
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-3xl min-h-[60vh] focus:outline-none dark:prose-invert",
          "aria-label": t`Document content`,
          role: "textbox",
          "aria-multiline": "true",
        },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])]
          if (files.length === 0 || editorRef.current === null) return false
          event.preventDefault()
          const range = editorRef.current.state.selection
          for (const file of files) {
            void insertFile(editorRef.current, range, file, "file")
          }
          return true
        },
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])]
          if (files.length === 0 || editorRef.current === null) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const range = {
            from: at?.pos ?? editorRef.current.state.selection.from,
            to: at?.pos ?? editorRef.current.state.selection.from,
          }
          for (const file of files) {
            void insertFile(editorRef.current, range, file, "file")
          }
          return true
        },
      },
      onCreate: ({ editor: created }) => {
        editorRef.current = created
      },
    },
    [ydoc, provider, writable],
  )
  useEffect(() => {
    if (editor) Object.assign(editor.storage.slashCommand, { items })
  })

  useEffect(() => {
    editor?.setEditable(writable)
  }, [editor, writable])

  const appliedTemplate = useRef(false)
  useEffect(() => {
    if (editor === null || props.template === undefined || !writable) return
    const seed = () => {
      if (appliedTemplate.current || !editor.isEmpty) return
      const found = findTemplate(props.template ?? "")
      if (found === undefined) return
      appliedTemplate.current = true
      editor.commands.setContent(found.content as JSONContent)
    }
    if (provider.isSynced) seed()
    provider.on("synced", seed)
    return () => {
      provider.off("synced", seed)
    }
  }, [editor, writable, provider, props.template])

  const selectionState = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (current === null) return null
      const { from, to } = current.state.selection
      return { from, to, empty: from === to }
    },
  })

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    const pending = pendingFile.current
    event.currentTarget.value = ""
    pendingFile.current = null
    if (file === undefined || pending === null || editor === null) return
    void insertFile(editor, pending.range, file, pending.accept)
  }

  return (
    <div className="relative">
      {!writable && (
        <output className="bg-muted mb-3 block rounded-md p-2 text-sm">
          {role === "commenter" ? (
            <Trans>You can comment on this document but not edit it.</Trans>
          ) : (
            <Trans>You can read this document. Ask an editor to change it.</Trans>
          )}
        </output>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={pickFile}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={pickFile}
      />
      <EditorContent editor={editor} />
      {slash !== null && <SlashMenu state={slash} />}
      <MentionPickerMenu picker={picker} />
      {selectionState !== null && !selectionState.empty && props.onSelectionComment && (
        <Button
          size="sm"
          className="mt-2"
          onClick={() => {
            if (editor === null) return
            const { from, to } = editor.state.selection
            const quote = editor.state.doc.textBetween(from, to, " ")
            const anchor = anchorFor(editor, from, to)
            if (anchor !== null) props.onSelectionComment?.(anchor, quote)
          }}
        >
          <Trans>Comment on selection</Trans>
        </Button>
      )}
      <TaskEmbedDialog
        open={taskDialog !== null}
        onClose={() => setTaskDialog(null)}
        projectId={props.projectId}
        onPick={(taskId) => {
          const pending = taskDialog
          setTaskDialog(null)
          if (pending === null || editor === null) return
          editor
            .chain()
            .focus()
            .deleteRange(pending.range)
            .insertContent({ type: "taskEmbed", attrs: { taskId } })
            .run()
        }}
      />
    </div>
  )
}

/** Asks for a task key such as `OPS-42` and resolves it to a task id. */
const TaskEmbedDialog = ({
  open,
  onClose,
  projectId,
  onPick,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly projectId: string | null
  readonly onPick: (taskId: TaskId) => void
}) => {
  const { t } = useLingui()
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const projects = useQuery(projectsQuery)

  const submit = async () => {
    const [projectKey, rawNumber] = key.trim().toUpperCase().split("-")
    const number = Number(rawNumber)
    const project = (projects.data ?? []).find((item) =>
      projectId === null ? item.key === projectKey : item.id === projectId,
    )
    if (project === undefined || !Number.isInteger(number)) {
      setError(t`No task matches that key.`)
      return
    }
    try {
      const task = await callApi((api) =>
        api.tasks.byNumber({ params: { projectId: project.id, number } }),
      )
      onPick(task.id)
      setKey("")
      setError(null)
    } catch {
      setError(t`No task matches that key.`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Embed a task</Trans>
          </DialogTitle>
        </DialogHeader>
        <Label htmlFor="embed-task-key">
          <Trans>Task key</Trans>
        </Label>
        <Input
          id="embed-task-key"
          value={key}
          placeholder="OPS-42"
          onChange={(event) => setKey(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit()
          }}
        />
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button onClick={() => void submit()}>
            <Trans>Embed</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
