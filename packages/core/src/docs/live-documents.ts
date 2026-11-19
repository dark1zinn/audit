import type { DocId } from "@audit/domain/ids"
import { Context } from "effect"

export interface LiveDocumentsShape {
  /** True while a collaboration session holds the doc in memory; its stored state must not be replaced. */
  readonly isOpen: (docId: DocId) => boolean
}

/** Docs open in the collaboration server. Without a collaboration server, none are open. */
export const LiveDocuments = Context.Reference<LiveDocumentsShape>("@audit/core/LiveDocuments", {
  defaultValue: () => ({ isOpen: () => false }),
})
