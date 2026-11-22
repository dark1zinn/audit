import { useLingui } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, CornerDownRight, CornerUpLeft, Copy, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { DocId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { sessionQuery } from "../../lib/queries.ts"
import { docHref } from "../../lib/entity-links.ts"
import { docKeys, docQuery, docTreeQuery } from "../docs/queries.ts"
import type { MoveTarget } from "../docs/tree.ts"
import { moveDown, moveFor, moveUp, subtreeIds } from "../docs/tree.ts"
import type { ActionGroup, EntityAction, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useGo, useRunAction } from "./shared.ts"

type DocTarget = Extract<EntityTarget, { kind: "doc" }>

/** Placeholder id for disabled queries when there is no target. */
const NO_DOC = "" as DocId

/** Moves a doc in the tree and refreshes doc caches. Shared by row menus and drag-and-drop. */
export const useMoveDoc = () => {
  const queryClient = useQueryClient()
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: ["docs"] }))
  return (docId: DocId, plan: MoveTarget | undefined, message: string) => {
    if (plan === undefined) return
    run.mutate(() => callApi((api) => api.docs.move({ params: { docId }, payload: plan })), {
      onSuccess: () => {
        toast.success(message)
        void queryClient.invalidateQueries({ queryKey: docKeys.doc(docId) })
      },
    })
  }
}

export const useDocActions = (
  target: DocTarget | null,
  open: boolean,
): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  const queryClient = useQueryClient()
  const doc = target?.doc
  const docId = doc?.id ?? NO_DOC
  const enabled = open && doc !== undefined

  // Loaded only once the menu opens, so rows stay cheap until used.
  const detail = useQuery({ ...docQuery(docId), enabled })
  const tree = useQuery({ ...docTreeQuery(doc?.projectId ?? null), enabled })
  const me = useQuery(sessionQuery)
  const move = useMoveDoc()

  const projectId = doc?.projectId ?? null
  const run = useRunAction(async () => {
    await queryClient.invalidateQueries({ queryKey: docKeys.space })
    if (projectId !== null) {
      await queryClient.invalidateQueries({ queryKey: docKeys.project(projectId) })
    }
    await queryClient.invalidateQueries({ queryKey: docKeys.doc(docId) })
  })

  if (target === null || doc === undefined) return []
  const projectKey = target.projectKey ?? null
  const href = docHref(doc.id, projectKey)
  const docs = tree.data ?? []
  const selfId = doc.id as DocId

  const runMove = (plan: MoveTarget | undefined, message: string) => move(selfId, plan, message)

  const siblings = docs
    .filter((candidate) => candidate.parentId === doc.parentId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
  const index = siblings.findIndex((candidate) => candidate.id === doc.id)
  const priorSibling = index > 0 ? siblings[index - 1] : undefined
  const parent = docs.find((candidate) => candidate.id === doc.parentId)

  const structure: ReadonlyArray<EntityAction> = [
    {
      id: "move-up",
      label: t`Move up`,
      icon: ArrowUp,
      disabled: moveUp(docs, selfId) === undefined,
      run: () => runMove(moveUp(docs, selfId), t`Moved up.`),
    },
    {
      id: "move-down",
      label: t`Move down`,
      icon: ArrowDown,
      disabled: moveDown(docs, selfId) === undefined,
      run: () => runMove(moveDown(docs, selfId), t`Moved down.`),
    },
    {
      id: "nest",
      label: t`Nest under previous`,
      icon: CornerDownRight,
      disabled: priorSibling === undefined,
      run: () =>
        runMove(
          priorSibling === undefined
            ? undefined
            : moveFor(docs, selfId, priorSibling.id as DocId, "inside"),
          t`Nested.`,
        ),
    },
    {
      id: "move-out",
      label: t`Move out`,
      icon: CornerUpLeft,
      disabled: parent === undefined,
      run: () =>
        runMove(
          parent === undefined
            ? undefined
            : { parentId: parent.parentId, afterId: parent.id as DocId },
          t`Moved out.`,
        ),
    },
  ]

  const descendantCount = tree.data === undefined ? 0 : subtreeIds(docs, selfId).size - 1
  const role = detail.data?.myRole
  const canDelete = role === "manager" || (role === "editor" && me.data?.userId === doc.createdBy)

  const deleteDoc = () => {
    const deletedIds = subtreeIds(docs, selfId)
    const openIsDeleted = [...deletedIds].some((id) => window.location.pathname.includes(id))
    const parentHref =
      parent !== undefined
        ? docHref(parent.id, projectKey)
        : projectKey === null
          ? "/docs"
          : `/p/${projectKey}/docs`
    run.mutate(
      () => callApi((api) => api.docs.delete({ params: { docId: selfId }, payload: {} })),
      {
        onSuccess: () => {
          toast.success(t`Doc deleted`)
          if (openIsDeleted) go(parentHref)
        },
      },
    )
  }

  const title = doc.title || t`Untitled`
  const deleteTitle =
    descendantCount === 0
      ? t`Delete “${title}”?`
      : descendantCount === 1
        ? t`Delete “${title}” and its 1 sub-doc?`
        : t`Delete “${title}” and its ${descendantCount} sub-docs?`

  const exportItems: ReadonlyArray<EntityAction> = [
    {
      id: "export-md",
      label: t`Markdown`,
      run: () => window.location.assign(`/api/docs/${doc.id}/export/md`),
    },
    {
      id: "export-html",
      label: t`HTML`,
      run: () => window.location.assign(`/api/docs/${doc.id}/export/html`),
    },
  ]

  return [
    [
      { id: "open", label: t`Open`, run: () => go(href) },
      {
        id: "open-side",
        label: t`Open to the side`,
        shortcut: "⇧↵",
        disabled: target.onOpenSide === undefined,
        run: target.onOpenSide,
      },
      {
        id: "open-tab",
        label: t`Open in new tab`,
        disabled: target.onOpenTab === undefined,
        run: target.onOpenTab,
      },
      ...(target.onRename === undefined
        ? []
        : [{ id: "rename", label: t`Rename`, shortcut: "F2", run: target.onRename }]),
      ...(target.onNewSubDoc === undefined
        ? []
        : [{ id: "new-sub-doc", label: t`New sub-doc`, run: target.onNewSubDoc }]),
    ],
    [
      { id: "structure", label: t`Move`, children: structure, pending: tree.isPending && enabled },
      { id: "export", label: t`Export`, children: exportItems },
      { id: "settings", label: t`Properties`, run: target.onOpenProperties },
    ],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
    ],
    [
      {
        id: "delete",
        label: t`Delete`,
        icon: Trash2,
        variant: "destructive",
        pending: detail.isPending && enabled,
        disabled: !canDelete,
        disabledReason: canDelete
          ? undefined
          : t`Only the creator or a manager can delete this doc`,
        confirm: {
          title: deleteTitle,
          description: t`The doc will be removed from the tree.`,
          confirmLabel: t`Delete`,
        },
        run: deleteDoc,
      },
    ],
  ]
}
