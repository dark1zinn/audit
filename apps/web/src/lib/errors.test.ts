import { describe, expect, test } from "bun:test"
import { errorKind, validationField } from "./errors.ts"

describe("errorKind", () => {
  test.each([
    ["Unauthorized", "unauthorized"],
    ["Forbidden", "forbidden"],
    ["NotFound", "notFound"],
    ["Conflict", "conflict"],
    ["ValidationError", "validation"],
    ["RateLimited", "rateLimited"],
    ["HttpClientError", "network"],
    ["SomethingElse", "unknown"],
  ])("maps %s to %s", (tag, kind) => {
    expect(errorKind({ _tag: tag })).toBe(kind as ReturnType<typeof errorKind>)
  })

  test("non-tagged values are unknown", () => {
    expect(errorKind(new Error("boom"))).toBe("unknown")
    expect(errorKind(null)).toBe("unknown")
  })
})

describe("validationField", () => {
  test("reads the field from a wrapped ApiError detail", () => {
    expect(validationField({ _tag: "ValidationError", detail: { field: "email" } })).toBe("email")
  })

  test("returns undefined when there is no field", () => {
    expect(validationField({ _tag: "ValidationError", message: "bad" })).toBeUndefined()
  })
})
