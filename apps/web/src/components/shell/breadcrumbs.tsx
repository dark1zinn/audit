import { Fragment } from "react"
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
import { docHref } from "../../lib/entity-links.ts"
import { docQuery, docTreeQuery } from "../docs/queries.ts"
import type { DocId } from "@audit/domain/ids"
import type { DocNode } from "@audit/domain/docs/schema"
import { t as tMacro } from "@lingui/core/macro"
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
  const routeParams = matches.map(
    (match) => match.params as Readonly<Record<string, string | undefined>>,
  )
  const docParams = routeParams.find((params) => params.docId !== undefined)
  const projectKey = routeParams.find((params) => params.key !== undefined)?.key ?? null
  const docCrumbs = useDocCrumbs(docParams?.docId as DocId | undefined, projectKey)

  // Crumb labels use the global Lingui instance, which the provider activates after the first render.
  if (!i18n.locale) return null

  const crumbs: Array<Crumb> = []
  for (const match of matches) {
    const crumb = match.staticData.crumb?.({
      params: match.params as Readonly<Record<string, string>>,
      projects: projects.data,
    })
    if (crumb !== undefined) crumbs.push(crumb)
  }
  crumbs.push(...docCrumbs)
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
            <Fragment key={`${index}-${crumb.label}`}>
              {index === 1 && lastIndex > 1 && (
                <>
                  <BreadcrumbItem className="sm:hidden">
                    <BreadcrumbEllipsis className="size-4" />
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="sm:hidden" />
                </>
              )}
              <BreadcrumbItem
                className={
                  isMiddle
                    ? "hidden min-w-0 shrink-0 sm:inline-flex sm:max-w-40"
                    : isLast
                      ? "min-w-0 flex-1 sm:flex-initial"
                      : "min-w-0 max-w-[5.5rem] sm:max-w-48 sm:shrink-0"
                }
              >
                {isLast || link === undefined ? (
                  <BreadcrumbPage className="truncate" title={crumb.label}>
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href={link}
                    className="inline-flex min-h-6 max-w-full min-w-0 items-center [@media(pointer:coarse)]:min-h-11"
                    title={crumb.label}
                    onClick={(event) => {
                      event.preventDefault()
                      void router.history.push(link)
                    }}
                  >
                    <span className="truncate">{crumb.label}</span>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && (
                <BreadcrumbSeparator className={isMiddle ? "hidden sm:list-item" : undefined} />
              )}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * Crumbs for an open doc: the Docs index, its parent docs from the cached tree, then its title.
 * Empty until the doc has loaded.
 */
function useDocCrumbs(docId: DocId | undefined, projectKey: string | null): Array<Crumb> {
  const doc = useQuery({ ...docQuery(docId ?? ("" as DocId)), enabled: docId !== undefined })
  const tree = useQuery({
    ...docTreeQuery(doc.data?.projectId ?? null),
    enabled: doc.data !== undefined,
  })
  if (docId === undefined || doc.data === undefined) return []
  const byId = new Map<string, DocNode>((tree.data ?? []).map((node) => [node.id, node] as const))
  const ancestors: Array<DocNode> = []
  let parent = byId.get(doc.data.parentId)
  while (parent !== undefined && !ancestors.includes(parent)) {
    ancestors.unshift(parent)
    parent = byId.get(parent.parentId)
  }
  return [
    { label: tMacro`Docs`, to: projectKey === null ? "/docs" : `/p/${projectKey}/docs` },
    ...ancestors.map((node) => ({ label: node.title, to: docHref(node.id, projectKey) })),
    { label: doc.data.title },
  ]
}
