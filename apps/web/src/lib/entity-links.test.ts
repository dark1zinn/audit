import { describe, expect, test } from "bun:test"
import type { EntityRef } from "@audit/domain/docs/schema"
import type { EntityId } from "@audit/domain/ids"
import { docHref, entityHref, taskHref } from "./entity-links.ts"

const id = "00000000-0000-4000-8000-000000000001" as EntityId
const ref = (fields: Partial<EntityRef>): EntityRef => ({
  id,
  restricted: false,
  deleted: false,
  ...fields,
})

describe("entityHref", () => {
  test.each<[string, Partial<EntityRef>, string | undefined]>([
    ["task", { type: "task", projectKey: "OPS", number: 42 }, "/p/OPS/t/42"],
    ["task without project", { type: "task", number: 42 }, undefined],
    ["task without number", { type: "task", projectKey: "OPS" }, undefined],
    ["project doc", { type: "doc", projectKey: "OPS" }, `/p/OPS/docs/${id}`],
    ["space doc", { type: "doc" }, `/docs/${id}`],
    ["project", { type: "project", projectKey: "OPS" }, "/p/OPS/board"],
    ["board", { type: "board", projectKey: "OPS" }, "/p/OPS/board"],
    ["channel", { type: "channel" }, `/c/${id}`],
    ["message", { type: "message", channelId: id }, `/c/${id}/t/${id}`],
    ["message without channel", { type: "message" }, undefined],
    ["event", { type: "event" }, `/calendar?event=${id}`],
    [
      "event with start",
      { type: "event", startsAt: "2026-06-10T15:00:00.000Z" },
      `/calendar?event=${id}&date=2026-06-10`,
    ],
    ["user", { type: "user" }, `/dm/${id}`],
    ["team", { type: "team" }, undefined],
  ])("%s", (_name, fields, expected) => {
    expect(entityHref(ref(fields))).toBe(expected)
  })

  test("restricted and deleted entities have no link", () => {
    expect(entityHref(ref({ type: "task", projectKey: "OPS", number: 1, restricted: true }))).toBe(
      undefined,
    )
    expect(entityHref(ref({ type: "doc", deleted: true }))).toBe(undefined)
  })
})

describe("helpers", () => {
  test("taskHref and docHref", () => {
    expect(taskHref("OPS", 7)).toBe("/p/OPS/t/7")
    expect(docHref(id, null)).toBe(`/docs/${id}`)
  })
})
