/**
 * Validates and normalises rich text from any writer before it is stored: user input, AI edits and
 * collab state alike. A refusal is a `ValidationError` naming the field.
 */
import { ValidationError } from "@audit/domain/errors"
import { RichDocError, sanitizeRichDoc } from "@audit/editor/sanitize"
import { Effect } from "effect"

export const cleanRichDoc = (input: unknown, field: string) =>
  Effect.try({
    try: () => sanitizeRichDoc(input),
    catch: (cause) =>
      new ValidationError({
        message: cause instanceof RichDocError ? cause.reason : "document is invalid",
        field,
      }),
  })
