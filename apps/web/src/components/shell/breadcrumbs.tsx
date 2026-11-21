import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useMatches, useRouter } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@audit/ui/components/ui/breadcrumb.tsx"
import { projectsQuery } from "../../lib/queries.ts"
import type { Crumb } from "./crumbs.ts"

/**
 * Header breadcrumbs. Each route contributes at most one crumb through `staticData.crumb`.
 * Middle crumbs collapse to an ellipsis below `sm`; the first and last crumbs always show.
 */
export function Breadcrumbs() {
  const { i18n } = useLingui()
  const matches = useMatches()
  const router = useRouter()
  const projects = useQuery(projectsQuery)

  // Crumb labels use the global Lingui instance, which the provider activates after the first render.
  if (!i18n.locale) return null

  const crumbs: Array<Crumb> = []
  for (const match of matches) {
    const crumb = match.staticData.crumb?.({
      params: match.params,
      projects: projects.data,
    })
    if (crumb !== undefined) crumbs.push(crumb)
  }
  if (crumbs.length === 0) return null

  const lastIndex = crumbs.length - 1
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === lastIndex
          const isMiddle = index > 0 && !isLast
          const link = crumb.to
          return (
            <BreadcrumbItem
              key={`${index}-${crumb.label}`}
              className={
                isMiddle ? "hidden min-w-0 sm:inline-flex" : "min-w-0 max-w-[12rem] sm:max-w-none"
              }
            >
              {index === 1 && lastIndex > 1 && (
                <span className="inline-flex items-center gap-1.5 sm:hidden">
                  <BreadcrumbEllipsis className="size-4" />
                  <BreadcrumbSeparator />
                </span>
              )}
              {isLast || link === undefined ? (
                <BreadcrumbPage className="truncate" title={crumb.label}>
                  {crumb.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  href={link}
                  className="truncate"
                  title={crumb.label}
                  onClick={(event) => {
                    event.preventDefault()
                    void router.history.push(link)
                  }}
                >
                  {crumb.label}
                </BreadcrumbLink>
              )}
              {!isLast && (
                <BreadcrumbSeparator className={isMiddle ? "hidden sm:list-item" : undefined} />
              )}
            </BreadcrumbItem>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
