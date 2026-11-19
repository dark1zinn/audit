/**
 * The commands an approved proposal may run, by name. Stored proposals carry JSON; each entry
 * decodes it with the command's own input codec, so a proposal stored today still runs under the
 * same validation tomorrow, and an unknown name is refused rather than run.
 */
import type { Conflict, Forbidden, NotFound, RateLimited, Unauthorized } from "@audit/domain/errors"
import { ValidationError } from "@audit/domain/errors"
import { Effect, Schema } from "effect"
import { createDoc } from "../docs/commands.ts"
import { createEvent } from "../calendar/commands.ts"
import { postMessage } from "../chat/commands.ts"
import { createTask, linkTask, moveTask, updateTask } from "../tasks/commands.ts"
import type { ToolRequirements } from "./requirements.ts"

/** The domain errors a command may fail with; anything else is a defect. */
export type RunError =
  | Conflict
  | Forbidden
  | NotFound
  | RateLimited
  | Unauthorized
  | ValidationError

interface RunnableCommand {
  readonly name: string
  readonly run: (json: unknown) => Effect.Effect<unknown, RunError, ToolRequirements>
}

const runnable = <I, IE, A, E extends RunError, R extends ToolRequirements>(
  name: string,
  command: {
    readonly input: Schema.Codec<I, IE>
    readonly execute: (input: I) => Effect.Effect<A, E, R>
  },
): RunnableCommand => ({
  name,
  run: (json) =>
    Schema.decodeUnknownEffect(Schema.toCodecJson(command.input))(json).pipe(
      Effect.mapError((error) => new ValidationError({ message: String(error) })),
      Effect.flatMap((input) => command.execute(input)),
    ),
})

export const proposalCommands: ReadonlyArray<RunnableCommand> = [
  runnable("task.create", createTask),
  runnable("task.update", updateTask),
  runnable("task.move", moveTask),
  runnable("task.link", linkTask),
  runnable("doc.create", createDoc),
  runnable("event.create", createEvent),
  runnable("message.post", postMessage),
]
