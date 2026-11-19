/**
 * Fails when an installed dependency is not under a permissive licence. Run after `bun install`.
 */
import { Glob } from "bun"

const allowed = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "Zlib",
  "WTFPL",
  // Fonts shipped with the web app.
  "OFL-1.1",
])

/** Weak-copyleft packages used only at build or test time, never shipped in the image. */
const buildOnly: Record<string, string> = {
  lightningcss: "Tailwind CSS compiler",
  "axe-core": "accessibility checks in the e2e suite",
  "@axe-core/playwright": "accessibility checks in the e2e suite",
}

const isAllowed = (expression: string): boolean => {
  const cleaned = expression.replace(/[()]/g, " ").trim()
  if (cleaned.includes(" OR ")) return cleaned.split(" OR ").some((part) => isAllowed(part))
  if (cleaned.includes(" AND ")) return cleaned.split(" AND ").every((part) => isAllowed(part))
  return allowed.has(cleaned)
}

const licenceOf = (manifest: { license?: unknown; licenses?: unknown }): string | null => {
  if (typeof manifest.license === "string") return manifest.license
  if (
    typeof manifest.license === "object" &&
    manifest.license !== null &&
    "type" in manifest.license
  ) {
    return String(manifest.license.type)
  }
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((entry: unknown) =>
        typeof entry === "object" && entry !== null && "type" in entry ? String(entry.type) : "",
      )
      .join(" OR ")
  }
  return null
}

const problems: Array<string> = []
const seen = new Set<string>()
const manifests = async function* () {
  for (const pattern of ["*/package.json", "@*/*/package.json"]) {
    yield* new Glob(`node_modules/.bun/*/node_modules/${pattern}`).scan({ dot: true })
  }
}
for await (const path of manifests()) {
  const manifest = await Bun.file(path).json()
  const id = `${manifest.name}@${manifest.version}`
  if (seen.has(id) || manifest.private === true) continue
  seen.add(id)
  const licence = licenceOf(manifest)
  const buildTool = Object.keys(buildOnly).some(
    (name) => manifest.name === name || manifest.name.startsWith(`${name}-`),
  )
  if (!buildTool && (licence === null || !isAllowed(licence))) {
    problems.push(`${id}: ${licence ?? "no licence"}`)
  }
}

if (problems.length > 0) {
  console.error(`Non-permissive or unknown licences:\n${problems.sort().join("\n")}`)
  process.exit(1)
}
console.log(`Licences OK for ${seen.size} packages.`)
