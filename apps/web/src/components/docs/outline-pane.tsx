import { useEffect, useMemo, useState } from "react"
import { useLingui } from "@lingui/react/macro"
import { ListTree } from "lucide-react"
import { EmptyState } from "../feedback.tsx"
import type { JSONContent } from "@tiptap/core"
import type { Editor } from "@tiptap/react"
import { type OutlineHeading, headingsFromDoc } from "./outline.ts"

const INDENT: Readonly<Record<1 | 2 | 3, string>> = {
  1: "ps-0",
  2: "ps-3",
  3: "ps-6",
}

/** Active heading is the last one whose top edge is at or above this offset from the viewport top. */
const ACTIVE_OFFSET_PX = 96
const DEBOUNCE_MS = 150

/** Last JSON snapshot together with the editor it came from, so a stale snapshot is never shown. */
interface EditorDocSnapshot {
  readonly source: Editor | null
  readonly json: JSONContent | null
}

/** The editor's document as JSON, refreshed after edits (debounced). `null` until an editor exists. */
export const useEditorDoc = (editor: Editor | null): JSONContent | null => {
  const [snapshot, setSnapshot] = useState<EditorDocSnapshot>({ source: null, json: null })
  useEffect(() => {
    if (editor === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => setSnapshot({ source: editor, json: editor.getJSON() })
    const onUpdate = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, DEBOUNCE_MS)
    }
    const first = setTimeout(refresh, 0)
    editor.on("update", onUpdate)
    return () => {
      clearTimeout(first)
      clearTimeout(timer)
      editor.off("update", onUpdate)
    }
  }, [editor])
  return editor !== null && snapshot.source === editor ? snapshot.json : null
}

/** Index of the active heading in `headings`, or `null` above the first one. */
const activeIndex = (editor: Editor, headings: ReadonlyArray<OutlineHeading>): number | null => {
  let found: number | null = null
  for (const [index, heading] of headings.entries()) {
    const dom = editor.view.nodeDOM(heading.pos)
    if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= ACTIVE_OFFSET_PX) {
      found = index
    }
  }
  return found
}

/** Headings of the open doc. Click jumps the editor to the heading; the current one is highlighted. */
export const OutlinePane = ({ editor }: { readonly editor: Editor | null }) => {
  const { t } = useLingui()
  const json = useEditorDoc(editor)
  const headings = useMemo(() => (json === null ? [] : headingsFromDoc(json)), [json])
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    if (editor === null) return
    let frame = 0
    const compute = () => {
      frame = 0
      setActive(activeIndex(editor, headings))
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(compute)
    }
    compute()
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true })
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [editor, headings])

  if (headings.length === 0) {
    return <EmptyState size="sm" icon={ListTree} title={t`No headings yet.`} />
  }

  return (
    <nav aria-label={t`Outline`} className="pt-3">
      <ul className="space-y-0.5 text-sm">
        {headings.map((heading, index) => (
          <li key={heading.pos} className={INDENT[heading.level]}>
            <button
              type="button"
              aria-current={active === index ? "location" : undefined}
              title={heading.text}
              className={`block w-full min-w-0 truncate rounded-sm px-2 py-1 text-start min-h-11 md:min-h-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none ${
                active === index
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground"
              }`}
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .setTextSelection(heading.pos + 1)
                  .scrollIntoView()
                  .run()
              }}
            >
              {heading.text === "" ? t`Untitled heading` : heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
