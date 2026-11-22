import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { t as tMacro } from "@lingui/core/macro"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { EntityContextMenu } from "../components/actions/entity-menu.tsx"
import type { ProjectId, UserId } from "@audit/domain/ids"
import type { SearchHit, SearchQuery } from "@audit/domain/search/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { Search } from "lucide-react"
import {
  EmptyState,
  ErrorMessage,
  LoadingRows,
  PageBody,
  PageHeader,
} from "../components/feedback.tsx"
import { membersQuery, projectsQuery } from "../lib/queries.ts"
import { searchResultsQuery, snippetParts } from "../lib/search.ts"

const PAGE_SIZE = 20
const ALL = "all"

/** Entity types the search page can filter on. */
const SEARCH_TYPES = [
  "task",
  "doc",
  "message",
  "channel",
  "event",
  "user",
  "team",
  "project",
] as const
type SearchType = (typeof SEARCH_TYPES)[number]

/** URL state of the search page; each key is always present and `undefined` when unset. */
export interface SearchParams {
  readonly q: string | undefined
  readonly types: string | undefined
  readonly projectId: string | undefined
  readonly authorId: string | undefined
  readonly from: string | undefined
  readonly to: string | undefined
  readonly mentionsMe: boolean | undefined
  readonly cursor: string | undefined
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

export const Route = createFileRoute("/_app/search")({
  validateSearch: (raw: Record<string, unknown>): SearchParams => ({
    q: text(raw.q),
    types: text(raw.types),
    projectId: text(raw.projectId),
    authorId: text(raw.authorId),
    from: text(raw.from),
    to: text(raw.to),
    mentionsMe: raw.mentionsMe === true || raw.mentionsMe === "true" ? true : undefined,
    cursor: text(raw.cursor),
  }),
  staticData: { crumb: () => ({ label: tMacro`Search` }) },
  component: SearchPage,
})

/** Maps URL state to the API query. Dates are inclusive days in UTC. */
const toSearchQuery = (params: SearchParams): SearchQuery => ({
  limit: PAGE_SIZE,
  ...(params.q === undefined ? {} : { q: params.q }),
  ...(params.types === undefined ? {} : { types: params.types }),
  ...(params.projectId === undefined ? {} : { projectId: params.projectId as ProjectId }),
  ...(params.authorId === undefined ? {} : { authorId: params.authorId as UserId }),
  ...(params.from === undefined ? {} : { updatedFrom: new Date(`${params.from}T00:00:00.000Z`) }),
  ...(params.to === undefined ? {} : { updatedTo: new Date(`${params.to}T23:59:59.999Z`) }),
  ...(params.mentionsMe === true ? { mentionsMe: "true" as const } : {}),
  ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
})

/** Adds or removes one type from the comma-separated `types` filter. */
const toggleType = (
  types: string | undefined,
  type: SearchType,
  on: boolean,
): string | undefined => {
  const current = (types ?? "").split(",").filter((entry) => entry !== "")
  const next = on
    ? [...current.filter((entry) => entry !== type), type]
    : current.filter((entry) => entry !== type)
  return next.length === 0 ? undefined : next.join(",")
}

function SearchPage() {
  const { t, i18n } = useLingui()
  const params = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const results = useQuery(searchResultsQuery(toSearchQuery(params)))
  const projects = useQuery(projectsQuery)
  const members = useQuery(membersQuery)

  /** Changing any filter starts again from the first page. */
  const update = (patch: Partial<SearchParams>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...patch, cursor: undefined }),
    })

  const typeLabels: Record<SearchType, string> = {
    task: t`Tasks`,
    doc: t`Docs`,
    message: t`Messages`,
    channel: t`Channels`,
    event: t`Events`,
    user: t`People`,
    team: t`Teams`,
    project: t`Projects`,
  }
  const selectedTypes = (params.types ?? "").split(",")
  const hitTypeLabels: Partial<Record<SearchHit["type"], string>> = {
    task: typeLabels.task,
    doc: typeLabels.doc,
    message: t`Message`,
    channel: t`Channel`,
    event: t`Event`,
    user: t`Person`,
    team: t`Team`,
    project: t`Project`,
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" })

  return (
    <PageBody width="wide">
      <PageHeader title={t`Search`} />
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <form
          aria-label={t`Search filters`}
          className="space-y-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            update({ q: text(data.get("q")) })
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="search-q">{t`Search`}</Label>
            <Input id="search-q" name="q" defaultValue={params.q ?? ""} autoComplete="off" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">{t`Types`}</legend>
            {SEARCH_TYPES.map((type) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox
                  id={`search-type-${type}`}
                  checked={selectedTypes.includes(type)}
                  onCheckedChange={(checked) =>
                    update({ types: toggleType(params.types, type, checked === true) })
                  }
                />
                <Label htmlFor={`search-type-${type}`}>{typeLabels[type]}</Label>
              </div>
            ))}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="search-project">{t`Project`}</Label>
            <Select
              value={params.projectId ?? ALL}
              onValueChange={(value) => update({ projectId: value === ALL ? undefined : value })}
            >
              <SelectTrigger id="search-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t`All projects`}</SelectItem>
                {(projects.data ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="search-author">{t`Author`}</Label>
            <Select
              value={params.authorId ?? ALL}
              onValueChange={(value) => update({ authorId: value === ALL ? undefined : value })}
            >
              <SelectTrigger id="search-author" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t`Anyone`}</SelectItem>
                {(members.data ?? []).map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">{t`Updated`}</legend>
            <div className="space-y-1">
              <Label htmlFor="search-from">{t`From`}</Label>
              <Input
                id="search-from"
                type="date"
                value={params.from ?? ""}
                onChange={(event) => update({ from: text(event.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="search-to">{t`To`}</Label>
              <Input
                id="search-to"
                type="date"
                value={params.to ?? ""}
                onChange={(event) => update({ to: text(event.target.value) })}
              />
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <Checkbox
              id="search-mentions-me"
              checked={params.mentionsMe === true}
              onCheckedChange={(checked) =>
                update({ mentionsMe: checked === true ? true : undefined })
              }
            />
            <Label htmlFor="search-mentions-me">{t`Mentions me`}</Label>
          </div>
          <Button type="submit" variant="outline" size="sm">
            {t`Apply search`}
          </Button>
        </form>

        <section aria-label={t`Results`} className="min-w-0 space-y-3">
          {results.isPending && <LoadingRows />}
          {results.isError && <ErrorMessage error={results.error} />}
          {results.isSuccess && results.data.hits.length === 0 && (
            <EmptyState icon={Search} title={t`No results.`} />
          )}
          {results.isSuccess && (
            <ol className="divide-y rounded-md border">
              {results.data.hits.map((hit) => (
                <EntityContextMenu
                  key={`${hit.type}:${hit.entityId}`}
                  target={{
                    kind: "entity",
                    ref: {
                      id: hit.entityId,
                      type: hit.type,
                      title: hit.title,
                      restricted: false,
                      deleted: false,
                    },
                    href: hit.url,
                  }}
                >
                  <li className="space-y-1 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{hitTypeLabels[hit.type] ?? hit.type}</span>
                      <span>{dateFormat.format(hit.updatedAt)}</span>
                    </div>
                    <Link to={hit.url} className="font-medium hover:underline">
                      {hit.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {snippetParts(hit.snippet).map((part, index) =>
                        part.mark ? (
                          <mark
                            key={index}
                            className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </p>
                  </li>
                </EntityContextMenu>
              ))}
            </ol>
          )}
          {results.isSuccess && results.data.nextCursor !== null && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ cursor: results.data.nextCursor ?? undefined })}
              >
                {t`Load more`}
              </Button>
            </div>
          )}
        </section>
      </div>
    </PageBody>
  )
}
