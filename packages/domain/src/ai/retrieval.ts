import { Schema } from "effect"
import { EntityType } from "../entity.ts"
import { EntityId, ProjectId } from "../ids.ts"

/** Narrows retrieval; visibility is always applied on top of this by the server. */
export const RetrievalScope = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  types: Schema.optionalKey(Schema.Array(EntityType)),
})
export type RetrievalScope = typeof RetrievalScope.Type

/** One retrieved chunk. `text` is the chunk text the model may cite; `url` navigates to the item. */
export const RetrievedChunk = Schema.Struct({
  entityId: EntityId,
  type: EntityType,
  title: Schema.String,
  chunk: Schema.Number,
  text: Schema.String,
  url: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  score: Schema.Number,
})
export type RetrievedChunk = typeof RetrievedChunk.Type
