import { describe, expect, test } from "bun:test"
import { detectLocale, matchLocale } from "./detect.ts"

describe("matchLocale", () => {
  test.each([
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["pt", "pt-BR"],
    ["es-MX", "es"],
    ["en-GB", "en"],
    ["EN", "en"],
    ["fr-FR", undefined],
    ["ptx", undefined],
  ] as const)("%s -> %s", (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected)
  })
})

describe("detectLocale", () => {
  test("saved profile language wins over the browser", () => {
    expect(
      detectLocale({ profile: "es", navigatorLanguages: ["pt-BR"], workspaceDefault: "en" }),
    ).toBe("es")
  })

  test("browser language is used when the profile has none", () => {
    expect(detectLocale({ profile: null, navigatorLanguages: ["fr-FR", "pt-PT"] })).toBe("pt-BR")
  })

  test("workspace default applies when the browser language is unsupported", () => {
    expect(detectLocale({ navigatorLanguages: ["fr-FR"], workspaceDefault: "es" })).toBe("es")
  })

  test("falls back to English", () => {
    expect(detectLocale({})).toBe("en")
    expect(
      detectLocale({ profile: "de", navigatorLanguages: ["fr"], workspaceDefault: "xx" }),
    ).toBe("en")
  })
})
