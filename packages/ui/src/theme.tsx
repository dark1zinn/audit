import * as React from "react"

export type ThemeMode = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"
export type Density = "comfortable" | "compact"

export const THEME_STORAGE_KEY = "audit.theme"
export const DENSITY_STORAGE_KEY = "audit.density"

interface ThemeContextValue {
  readonly theme: ThemeMode
  readonly resolvedTheme: ResolvedTheme
  readonly setTheme: (theme: ThemeMode) => void
  readonly density: Density
  readonly setDensity: (density: Density) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const readStorage = <T extends string>(key: string, allowed: ReadonlyArray<T>): T | undefined => {
  try {
    const value = window.localStorage.getItem(key)
    return allowed.find((candidate) => candidate === value)
  } catch {
    return undefined
  }
}

const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage can be disabled (private mode); the preference then lasts for the page only.
  }
}

const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches

/** Relative luminance of a `#rrggbb` colour; used to pick a readable foreground. */
export const isLightColor = (hex: string): boolean => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return false
  const value = Number.parseInt(match[1] ?? "000000", 16)
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
  return luminance > 0.4
}

/** Sets the workspace accent on <html>; the stylesheet default is used when `hex` is absent. */
export const applyAccent = (hex: string | undefined) => {
  const root = document.documentElement
  if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) {
    root.style.removeProperty("--brand")
    root.style.removeProperty("--brand-foreground")
    return
  }
  root.style.setProperty("--brand", hex)
  root.style.setProperty("--brand-foreground", isLightColor(hex) ? "#111111" : "#ffffff")
}

export interface ThemeProviderProps {
  /** Workspace default, used until the user picks a theme on this device. */
  readonly defaultTheme?: ThemeMode
  /** Workspace accent colour (`#rrggbb`). */
  readonly accentColor?: string | undefined
  readonly defaultDensity?: Density
  readonly children: React.ReactNode
}

export const ThemeProvider = ({
  defaultTheme = "system",
  accentColor,
  defaultDensity = "comfortable",
  children,
}: ThemeProviderProps) => {
  // A device choice wins once made; until then the workspace default applies.
  const [storedTheme, setStoredTheme] = React.useState<ThemeMode | undefined>(() =>
    readStorage(THEME_STORAGE_KEY, ["light", "dark", "system"]),
  )
  const [storedDensity, setStoredDensity] = React.useState<Density | undefined>(() =>
    readStorage(DENSITY_STORAGE_KEY, ["comfortable", "compact"]),
  )
  const theme = storedTheme ?? defaultTheme
  const density = storedDensity ?? defaultDensity
  const [systemDark, setSystemDark] = React.useState(systemPrefersDark)

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme

  React.useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", resolvedTheme === "dark")
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  React.useEffect(() => {
    document.documentElement.dataset["density"] = density
  }, [density])

  React.useEffect(() => {
    applyAccent(accentColor)
  }, [accentColor])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      density,
      setTheme: (next) => {
        writeStorage(THEME_STORAGE_KEY, next)
        setStoredTheme(next)
      },
      setDensity: (next) => {
        writeStorage(DENSITY_STORAGE_KEY, next)
        setStoredDensity(next)
      },
    }),
    [theme, resolvedTheme, density],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => {
  const context = React.useContext(ThemeContext)
  if (context === null) throw new Error("useTheme must be used inside <ThemeProvider>")
  return context
}
