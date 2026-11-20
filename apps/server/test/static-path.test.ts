import { describe, expect, test } from "bun:test"
import { resolveStaticPath } from "../src/static-path.ts"

const ROOT = "/srv/web"

describe("resolveStaticPath", () => {
  test("maps a path inside the root to a file", () => {
    expect(resolveStaticPath(ROOT, "/assets/app.js")).toEqual({
      kind: "file",
      path: "/srv/web/assets/app.js",
    })
  })

  test("refuses traversal out of the root", () => {
    expect(resolveStaticPath(ROOT, "/..%2F..%2Fetc%2Fpasswd")).toEqual({ kind: "outside" })
    expect(resolveStaticPath(ROOT, "/../secret")).toEqual({ kind: "outside" })
  })

  test("refuses a sibling directory that shares the root's prefix", () => {
    expect(resolveStaticPath(ROOT, "/..%2Fweb-evil%2Fsecret")).toEqual({ kind: "outside" })
  })

  test("reports malformed percent-encoding instead of throwing", () => {
    expect(resolveStaticPath(ROOT, "/%E0%A4%A")).toEqual({ kind: "malformed" })
  })
})
