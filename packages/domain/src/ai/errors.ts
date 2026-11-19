import { Schema } from "effect"

/** The AI provider could not be reached or answered with an error; retry later. */
export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()(
  "AiUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
