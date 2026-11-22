/** Whether `pathname` is `to` or lives under it. `/` only matches itself. */
export function isPathActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** Two-letter initials for avatar fallbacks. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
