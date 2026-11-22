import type { ProjectSummary } from "@audit/domain/projects/schema"

/** One breadcrumb segment. Without `to` the segment is the current page and is not a link. */
export interface Crumb {
  readonly label: string
  readonly to?: string
}

/** Inputs a route's crumb function may use. `projects` is undefined until the list has loaded. */
export interface CrumbContext {
  readonly params: Readonly<Record<string, string>>
  readonly projects: ReadonlyArray<ProjectSummary> | undefined
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Breadcrumb contributed by this route. Return `undefined` to hide it. */
    crumb?: (context: CrumbContext) => Crumb | undefined
  }
}
