import { describe, expect, test } from "bun:test"
import { writeTools } from "@audit/core/ai/tools"

describe("write tool approval", () => {
  test("posting a message always needs the user's approval", () => {
    expect(writeTools.find((tool) => tool.name === "draft_message")?.autoApprovable).toBe(false)
  })
})
