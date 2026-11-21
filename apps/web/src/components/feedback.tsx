import { useLingui } from "@lingui/react/macro"
import { Skeleton } from "@audit/ui/components/ui/skeleton.tsx"
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@audit/ui/components/ui/empty.tsx"
import { errorKind } from "../lib/errors.ts"

/** Maps a failed API or auth call to a translated, user-facing message. */
export function ErrorMessage({ error }: { readonly error: unknown }) {
  const { t } = useLingui()
  const message = (() => {
    switch (errorKind(error)) {
      case "unauthorized":
        return t`Your session has ended. Sign in again.`
      case "forbidden":
        return t`You do not have permission to do that.`
      case "notFound":
        return t`That item no longer exists.`
      case "conflict":
        return t`That conflicts with the current data. Refresh and try again.`
      case "validation":
        return t`Check the highlighted fields and try again.`
      case "rateLimited":
        return t`Too many attempts. Wait a moment and try again.`
      case "network":
        return t`Cannot reach the server. Check your connection.`
      case "unknown":
        return t`Something went wrong. Try again.`
    }
  })()
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string
  readonly description?: string
  readonly actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-6">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2 ms-auto">{actions}</div>
      )}
    </header>
  )
}

/**
 * Page content container. `full` fills the content area (boards, docs, chat); `wide` is for lists,
 * inbox and admin; `narrow` is for settings and forms.
 */
export function PageBody({
  width = "full",
  className,
  children,
}: {
  readonly width?: "full" | "wide" | "narrow"
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <div
      className={[
        "mx-auto w-full",
        width === "wide" ? "max-w-6xl" : "",
        width === "narrow" ? "max-w-3xl" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  )
}

export function LoadingRows({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}

/**
 * Shared empty state. `default` is a page or section block with icon, title, optional description
 * and primary action. `sm` is a compact inline hint for panels: a muted one-liner with an icon.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
}: {
  readonly icon?: LucideIcon
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
  readonly size?: "default" | "sm"
}) {
  if (size === "sm") {
    return (
      <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        {Icon !== undefined && <Icon aria-hidden="true" className="size-4 shrink-0" />}
        <span>{title}</span>
      </p>
    )
  }
  return (
    <Empty className="border">
      <EmptyHeader>
        {Icon !== undefined && (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action !== undefined && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
