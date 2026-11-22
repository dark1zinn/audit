/** True on Apple platforms, where the command modifier is ⌘ rather than Ctrl. */
export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** The label of the primary modifier key for shortcut hints: ⌘ on Apple platforms, otherwise Ctrl. */
export const modKey = (): string => (isMacPlatform() ? "⌘" : "Ctrl")
