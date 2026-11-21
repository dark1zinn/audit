import { useLingui } from "@lingui/react/macro"
import { Copy, ExternalLink } from "lucide-react"
import { entityHref } from "../../lib/entity-links.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useGo } from "./shared.ts"

type EntityRefTarget = Extract<EntityTarget, { kind: "entity" }>

/** Actions for a mention or wikilink chip, derived from its resolved reference. */
export const useEntityRefActions = (target: EntityRefTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  if (target === null) return []
  const href = entityHref(target.ref)
  if (href === undefined) return []
  const key = target.ref.key

  return [
    [{ id: "open", label: t`Open`, icon: ExternalLink, run: () => go(href) }],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
      ...(key !== undefined
        ? [{ id: "copy-key", label: t`Copy key`, run: () => copy(key, t`Key copied`) }]
        : []),
    ],
  ]
}
