/**
 * Cross-references: mentions and links become rows in `references`, diffed in the same transaction
 * as the change that made them.
 */
import { entities, references } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import type { ReferenceKind } from "@audit/domain/entity"
import type { EntityId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, eq, inArray } from "drizzle-orm"
import { Effect } from "effect"

export interface ReferenceTarget {
  readonly targetId: EntityId
  readonly snippet?: string
}

/**
 * Makes the `kind` references from `sourceId` exactly `targets`. Unknown target IDs are ignored.
 * Returns the newly added target IDs (for mention notifications).
 */
export const syncReferences = (
  sourceId: EntityId,
  kind: ReferenceKind,
  targets: ReadonlyArray<ReferenceTarget>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const actor = yield* CurrentActor
    const existing = yield* db
      .select({ targetId: references.targetId, snippet: references.snippet })
      .from(references)
      .where(and(eq(references.sourceId, sourceId), eq(references.kind, kind)))
    const wanted = new Map(targets.map((t) => [t.targetId as string, t.snippet ?? null]))
    const current = new Map(existing.map((r) => [r.targetId, r.snippet]))

    const removed = [...current.keys()].filter((id) => !wanted.has(id))
    if (removed.length > 0) {
      yield* db
        .delete(references)
        .where(
          and(
            eq(references.sourceId, sourceId),
            eq(references.kind, kind),
            inArray(references.targetId, removed),
          ),
        )
    }

    const candidates = [...wanted.keys()].filter((id) => !current.has(id))
    const known =
      candidates.length === 0
        ? []
        : yield* db
            .select({ id: entities.id })
            .from(entities)
            .where(inArray(entities.id, candidates))
    const added = known.map((row) => row.id as EntityId).filter((id) => id !== sourceId)
    if (added.length > 0) {
      yield* db.insert(references).values(
        added.map((targetId) => ({
          sourceId,
          targetId,
          kind,
          snippet: wanted.get(targetId) ?? null,
          createdBy: actorUserId(actor),
        })),
      )
    }

    for (const [targetId, snippet] of wanted) {
      if (current.has(targetId) && current.get(targetId) !== snippet) {
        yield* db
          .update(references)
          .set({ snippet })
          .where(
            and(
              eq(references.sourceId, sourceId),
              eq(references.targetId, targetId),
              eq(references.kind, kind),
            ),
          )
      }
    }
    return added
  }).pipe(Effect.orDie)
