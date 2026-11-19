import { Context } from "effect"

export interface RequestMetaShape {
  readonly ip?: string
  readonly userAgent?: string
  readonly requestId?: string
}

/** Where the current request came from; recorded with every audit entry. Empty for jobs. */
export const RequestMeta = Context.Reference<RequestMetaShape>("@audit/core/RequestMeta", {
  defaultValue: () => ({}),
})
