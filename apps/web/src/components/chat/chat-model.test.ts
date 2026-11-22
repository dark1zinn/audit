import { describe, expect, test } from "bun:test"
import type { ChannelSummary } from "@audit/domain/chat/schema"
import {
  chatLandingChannelId,
  chatUnreadTotal,
  filterChannels,
  orderChannels,
} from "./chat-model.ts"

// Fixture ids are plain strings; the branded id types are irrelevant to this logic.
type Fixture = Omit<Partial<ChannelSummary>, "id"> & { readonly id: string }

const channel = (overrides: Fixture): ChannelSummary =>
  ({
    kind: "public",
    name: overrides.id,
    people: [],
    unread: 0,
    mentions: 0,
    ...overrides,
  }) as unknown as ChannelSummary

const ids = (list: ReadonlyArray<ChannelSummary>) => list.map((c) => String(c.id))

const general = channel({ id: "general", name: "general", unread: 3 })
const design = channel({ id: "design", name: "design", kind: "private", unread: 2 })
const ana = channel({
  id: "dm-ana",
  kind: "dm",
  unread: 5,
  people: [{ id: "u1", name: "Ana" } as ChannelSummary["people"][number]],
})
const team = channel({ id: "dm-team", kind: "group_dm", unread: 1 })

describe("chatUnreadTotal", () => {
  test("sums unread counts across rooms and direct messages", () => {
    expect(chatUnreadTotal([general, design, ana, team])).toBe(11)
  })

  test("is zero with no channels", () => {
    expect(chatUnreadTotal([])).toBe(0)
  })
})

describe("orderChannels", () => {
  test("lists rooms before direct messages, keeping server order within each", () => {
    expect(ids(orderChannels([ana, general, team, design]))).toEqual([
      "general",
      "design",
      "dm-ana",
      "dm-team",
    ])
  })
})

describe("filterChannels", () => {
  test("matches the display title, ignoring case and surrounding spaces", () => {
    expect(ids(filterChannels([general, design, ana], "  ANA "))).toEqual(["dm-ana"])
    expect(ids(filterChannels([general, design], "#des"))).toEqual(["design"])
  })

  test("a blank query keeps everything", () => {
    expect(filterChannels([general, design], "  ")).toHaveLength(2)
  })
})

describe("chatLandingChannelId", () => {
  test("returns the last visited channel when it still exists", () => {
    expect(String(chatLandingChannelId([general, design, ana], "design"))).toBe("design")
  })

  test("falls back to the first channel in sidebar order when the last one is gone", () => {
    expect(String(chatLandingChannelId([ana, general, design], "deleted"))).toBe("general")
  })

  test("falls back to the first channel when nothing was visited", () => {
    expect(String(chatLandingChannelId([ana, general], null))).toBe("general")
  })

  test("is undefined without channels", () => {
    expect(chatLandingChannelId([], "general")).toBeUndefined()
  })
})
