import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import type { Editor } from "@tiptap/core"
import type { DocId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { Sparkles } from "lucide-react"
import { ErrorMessage } from "../feedback.tsx"
import { AiTextDialog, useAiAction } from "../ai/ai-text-dialog.tsx"
import { openAssistantWith } from "../ai/ai-store.ts"

interface Result {
  readonly title: string
  readonly text: string
  /** Selection to replace when the result is inserted; null when insert is not offered. */
  readonly replace: { readonly from: number; readonly to: number } | null
}

/** Editor AI actions. Generated text is previewed and inserted only on request; writes go through proposals. */
export function DocAiMenu({
  docId,
  title,
  canWrite,
  editorRef,
}: {
  readonly docId: DocId
  readonly title: string
  readonly canWrite: boolean
  readonly editorRef: { readonly current: Editor | null }
}) {
  const { t } = useLingui()
  const action = useAiAction()
  const [result, setResult] = useState<Result | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedText = (editor: Editor) => {
    const { from, to } = editor.state.selection
    return { from, to, text: editor.state.doc.textBetween(from, to, "\n").trim() }
  }

  const run = (
    kind: "summarize" | "rewrite" | "fix_grammar",
    label: string,
    needsSelection: boolean,
  ) => {
    const editor = editorRef.current
    if (editor === null) return
    setNotice(null)
    if (!needsSelection) {
      action.mutate(
        { surface: "editor", action: kind, docId },
        { onSuccess: (data) => setResult({ title: label, text: data.text ?? "", replace: null }) },
      )
      return
    }
    const picked = selectedText(editor)
    if (picked.text === "") {
      setNotice(t`Select some text first.`)
      return
    }
    action.mutate(
      { surface: "editor", action: kind, docId, selection: picked.text },
      {
        onSuccess: (data) =>
          setResult({
            title: label,
            text: data.text ?? "",
            replace: canWrite ? { from: picked.from, to: picked.to } : null,
          }),
      },
    )
  }

  const insert = (text: string) => {
    const editor = editorRef.current
    if (result === null || result.replace === null || editor === null) return
    const size = editor.state.doc.content.size
    const from = Math.min(result.replace.from, size)
    const to = Math.min(result.replace.to, size)
    editor.chain().focus().insertContentAt({ from, to }, text).run()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={action.isPending}>
            <Sparkles aria-hidden="true" className="size-4" />
            <Trans>AI</Trans>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => run("summarize", t`Summary`, false)}>
            <Trans>Summarise document</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("rewrite", t`Rewritten text`, true)}>
            <Trans>Rewrite selection</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("fix_grammar", t`Corrected text`, true)}>
            <Trans>Fix grammar in selection</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              openAssistantWith(
                t`Continue the document "${title}" (id ${docId}) from where it ends. Propose the addition as a document edit.`,
              )
            }
          >
            <Trans>Continue writing in assistant</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              openAssistantWith(
                t`Extract the action items from the document "${title}" (id ${docId}) and propose each as a task.`,
              )
            }
          >
            <Trans>Extract tasks in assistant</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {notice === null ? null : <output className="text-sm text-muted-foreground">{notice}</output>}
      {action.isError ? <ErrorMessage error={action.error} /> : null}
      {result === null ? null : (
        <AiTextDialog
          open
          onOpenChange={(open) => {
            if (!open) setResult(null)
          }}
          title={result.title}
          text={result.text}
          onInsert={result.replace === null ? undefined : insert}
        />
      )}
    </>
  )
}
