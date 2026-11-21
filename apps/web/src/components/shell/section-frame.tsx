import { useEffect, useRef, type ReactNode } from "react"
import { useRouterState } from "@tanstack/react-router"

/** Link style inside a section nav: underline below `md`, a filled row beside the page from `md`. */
export const SECTION_LINK_CLASS =
  "flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:rounded-md md:border-b-0 md:px-2 aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground md:aria-[current=page]:bg-accent"

/** One titled group in a section nav. Titles show only beside the page (`md+`). */
export function SectionGroup({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex gap-1 md:flex-col md:gap-0.5">
      <p className="hidden px-2 pb-1 text-xs font-medium text-muted-foreground md:block">{title}</p>
      {children}
    </div>
  )
}

/**
 * GitHub-style section layout. `md+`: a vertical left nav beside the page. Below `md`: a
 * horizontally scrollable underline nav above it. `nav` is the caller's `SectionGroup`s.
 */
export function SectionFrame({
  label,
  nav,
  children,
}: {
  readonly label: string
  readonly nav: ReactNode
  readonly children: ReactNode
}) {
  const navRef = useRef<HTMLElement>(null)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // Keep the current link visible in the horizontal nav below `md`. Scrolls only the nav,
  // never the page.
  useEffect(() => {
    const navEl = navRef.current
    const current = navEl?.querySelector<HTMLElement>('[aria-current="page"]')
    if (navEl === null || navEl === undefined || current === null || current === undefined) return
    const navBox = navEl.getBoundingClientRect()
    const itemBox = current.getBoundingClientRect()
    if (itemBox.left < navBox.left) navEl.scrollBy({ left: itemBox.left - navBox.left - 16 })
    else if (itemBox.right > navBox.right)
      navEl.scrollBy({ left: itemBox.right - navBox.right + 16 })
  }, [pathname])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 md:flex-row md:gap-10">
      <nav
        ref={navRef}
        aria-label={label}
        className="-mx-4 shrink-0 overflow-x-auto border-b px-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] md:mx-0 md:w-52 md:overflow-visible md:border-b-0 md:px-0 md:[mask-image:none]"
      >
        <div className="flex min-w-max gap-1 md:min-w-0 md:flex-col md:gap-4">{nav}</div>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
