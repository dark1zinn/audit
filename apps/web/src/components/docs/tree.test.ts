import { describe, expect, test } from "bun:test"
import type { DocNode } from "@audit/domain/docs/schema"
import type { DocId, EntityId, ProjectId } from "@audit/domain/ids"
import { buildTree, moveDown, moveFor, moveUp, subtreeIds, visibleRows } from "./tree.ts"

const doc = (id: string, parentId: string, position: string): DocNode => ({
  id: id as DocId,
  parentId: parentId as EntityId,
  projectId: "p" as ProjectId,
  title: id,
  icon: null,
  position,
  restricted: false,
  reviewEveryDays: null,
  ownerUserId: null,
  verifiedAt: null,
  lastEditedAt: null,
  updatedAt: new Date(0),
  version: 1,
})

const docs = [
  doc("a", "proj", "a0"),
  doc("b", "proj", "a1"),
  doc("a1", "a", "a0"),
  doc("a2", "a", "a1"),
]

const ids = (nodes: ReadonlyArray<{ readonly doc: DocNode }>) =>
  nodes.map((node) => node.doc.id as string)

describe("buildTree", () => {
  test("nests by parent and orders by position", () => {
    const tree = buildTree(docs)
    expect(ids(tree)).toEqual(["a", "b"])
    expect(ids(tree[0]!.children)).toEqual(["a1", "a2"])
    expect(tree[0]!.children[0]!.depth).toBe(1)
  })

  test("treats docs with a missing parent as roots", () => {
    const tree = buildTree([doc("orphan", "missing", "a0")])
    expect(ids(tree)).toEqual(["orphan"])
  })

  test("hides children of collapsed nodes", () => {
    const rows = visibleRows(buildTree(docs), new Set(["a"]))
    expect(ids(rows)).toEqual(["a", "b"])
  })
})

describe("moves", () => {
  test("subtree includes descendants", () => {
    expect([...subtreeIds(docs, "a" as DocId)].sort()).toEqual(["a", "a1", "a2"])
  })

  test("dropping before a sibling places after its previous sibling", () => {
    expect(moveFor(docs, "b" as DocId, "a" as DocId, "before")).toEqual({
      parentId: "proj" as EntityId,
      afterId: null,
    })
  })

  test("dropping inside refuses to nest a doc under its own descendant", () => {
    expect(moveFor(docs, "a" as DocId, "a1" as DocId, "inside")).toBeUndefined()
  })

  test("moveUp and moveDown use sibling order", () => {
    expect(moveUp(docs, "b" as DocId)).toEqual({ parentId: "proj" as EntityId, afterId: null })
    expect(moveDown(docs, "a" as DocId)).toEqual({
      parentId: "proj" as EntityId,
      afterId: "b" as DocId,
    })
    expect(moveUp(docs, "a" as DocId)).toBeUndefined()
  })
})
