import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Calendar,
  CircleCheck,
  FileText,
  FolderKanban,
  Hash,
  Lock,
  MessageSquare,
  AtSign,
  type LucideIcon,
} from "lucide-react"
import type { EntityRef } from "@audit/domain/docs/schema"
import type { EntityId } from "@audit/domain/ids"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@audit/ui/components/ui/hover-card.tsx"
import { entityRefQuery } from "../docs/queries.ts"
import { entityHref } from "../../lib/entity-links.ts"
import { EntityContextMenu } from "../actions/entity-menu.tsx"

interface EntityChipProps {
  readonly id: EntityId
  /** Type stored in the mention node; used until the live reference loads. */
  readonly type: string
  /** Label stored in the mention node. */
  readonly label: string
}

const ICON_BY_TYPE: Readonly<Record<string, LucideIcon>> = {
  task: CircleCheck,
  project: FolderKanban,
  board: FolderKanban,
  channel: Hash,
  message: MessageSquare,
  event: Calendar,
  user: AtSign,
}

/**
 * Mention or wikilink chip. Resolves the entity live: a link when it has a page, a
 * lock when restricted, a struck-through label when deleted. Right-click (and Shift+F10)
 * opens the entity actions.
 */
export function EntityChip({ id, type, label }: EntityChipProps) {
  const { t } = useLingui()
  const ref = useQuery(entityRefQuery(id))

  if (ref.isPending) return <span className="text-muted-foreground">@{label}</span>
  if (ref.data === null || ref.data === undefined) {
    return <span className="text-muted-foreground">@{label}</span>
  }
  const data: EntityRef = ref.data

  if (data.restricted) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-muted-foreground">
        <Lock aria-hidden className="size-3" />
        {t`Restricted item`}
      </span>
    )
  }
  if (data.deleted) {
    return <span className="text-muted-foreground line-through">@{label}</span>
  }

  const Icon = ICON_BY_TYPE[data.type ?? type] ?? FileText
  const title = data.title ?? data.key ?? label
  const href = entityHref(data)
  const content = (
    <>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
    </>
  )
  if (href === undefined) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 font-medium text-primary">
        {content}
      </span>
    )
  }

  return (
    <EntityContextMenu target={{ kind: "entity", ref: data }}>
      <span className="inline-flex max-w-full" onContextMenu={(event) => event.stopPropagation()}>
        <HoverCard openDelay={400}>
          <HoverCardTrigger asChild>
            <Link
              to={href}
              className="inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {content}
            </Link>
          </HoverCardTrigger>
          <HoverCardContent className="w-72 text-sm">
            <p className="text-xs text-muted-foreground">{data.type ?? type}</p>
            <p className="font-medium">{title}</p>
            {data.key !== undefined ? (
              <p className="font-mono text-xs text-muted-foreground">{data.key}</p>
            ) : null}
            {data.projectKey !== undefined ? (
              <p className="text-xs text-muted-foreground">{data.projectKey}</p>
            ) : null}
          </HoverCardContent>
        </HoverCard>
      </span>
    </EntityContextMenu>
  )
}
