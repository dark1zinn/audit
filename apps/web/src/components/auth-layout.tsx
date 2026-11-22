import type { ReactNode } from "react"

/** Centred card for pre-session screens (setup, login, invites), with a brand row above it. */
export function AuthLayout({
  title,
  description,
  workspaceName,
  children,
}: {
  readonly title: string
  readonly description?: string
  /** Shown in the brand row; the app name is used when the caller has no workspace yet. */
  readonly workspaceName?: string
  readonly children: ReactNode
}) {
  const brand = workspaceName ?? "audit"
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <div className="flex max-w-full items-center gap-2 text-sm font-medium">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
        >
          {brand.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 truncate" title={brand}>
          {brand}
        </span>
      </div>
      <main id="main" className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description !== undefined && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </header>
        {children}
      </main>
    </div>
  )
}
