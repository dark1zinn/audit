import type { ReactNode } from "react"

/** Centred card for pre-session screens (setup, login, invites). */
export function AuthLayout({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
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
