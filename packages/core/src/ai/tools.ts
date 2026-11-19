/**
 * The assistant's tools. Read tools run the same queries the UI uses, as the AI actor acting for
 * the user. Write tools never run directly: they hand a command and its preview to `proposals`,
 * which runs it only after a person approves (or immediately for auto-approved low-risk tools).
 */
import type { AiConversationId } from "@audit/domain/ids"
import { CalendarId, ChannelId, ColumnId, DocId, EntityId, TaskId, UserId } from "@audit/domain/ids"
import { RelationKind } from "@audit/domain/tasks/schema"
import { Effect, Schema } from "effect"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import { type ProposalDraft, proposeChange } from "./proposals.ts"
import * as Commands from "./tool-commands.ts"
import type { ToolRequirements } from "./requirements.ts"

/** What a tool hands back to the model. Failures are output too, so the model can correct itself. */
export interface ToolOutput {
  readonly output: unknown
}

export interface ToolContext {
  readonly conversationId: AiConversationId
}

interface ToolBase {
  readonly name: string
  readonly description: string
  readonly parameters: Schema.Codec<unknown, unknown>
  readonly call: (
    raw: unknown,
    ctx: ToolContext,
  ) => Effect.Effect<ToolOutput, never, ToolRequirements>
}

export interface ReadTool extends ToolBase {
  readonly kind: "read"
}

export interface WriteTool extends ToolBase {
  readonly kind: "write"
  /** Low-risk tools a person may let run without a proposal (`ai_user_preferences`). */
  readonly autoApprovable: boolean
}

export type AiTool = ReadTool | WriteTool

export const describeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const message = "message" in error && typeof error.message === "string" ? error.message : ""
    return message.length > 0 ? `${String(error._tag)}: ${message}` : String(error._tag)
  }
  return String(error)
}

/** Errors become tool output (the model sees them); the turn continues. */
const toOutput = <A>(effect: Effect.Effect<A, unknown, ToolRequirements>) =>
  effect.pipe(
    Effect.map((output): ToolOutput => ({ output })),
    Effect.catch((error) =>
      Effect.succeed<ToolOutput>({ output: { error: describeError(error) } }),
    ),
  )

const readTool = <I, A>(spec: {
  readonly name: string
  readonly description: string
  readonly input: Schema.Codec<I, unknown>
  readonly run: (input: I) => Effect.Effect<A, unknown, ToolRequirements>
}): ReadTool => ({
  kind: "read",
  name: spec.name,
  description: spec.description,
  parameters: spec.input as Schema.Codec<unknown, unknown>,
  call: (raw) =>
    toOutput(Schema.decodeUnknownEffect(spec.input)(raw).pipe(Effect.flatMap(spec.run))),
})

const writeTool = <I>(spec: {
  readonly name: string
  readonly description: string
  readonly input: Schema.Codec<I, unknown>
  readonly autoApprovable: boolean
  readonly prepare: (input: I) => Effect.Effect<ProposalDraft, unknown, ToolRequirements>
}): WriteTool => ({
  kind: "write",
  name: spec.name,
  description: spec.description,
  parameters: spec.input as Schema.Codec<unknown, unknown>,
  autoApprovable: spec.autoApprovable,
  call: (raw, ctx) =>
    toOutput(
      Schema.decodeUnknownEffect(spec.input)(raw).pipe(
        Effect.flatMap(spec.prepare),
        Effect.flatMap((built) =>
          proposeChange.execute({
            ...built,
            preview: { ...built.preview, fields: [...built.preview.fields] },
            tool: spec.name,
            autoApprovable: spec.autoApprovable,
            conversationId: ctx.conversationId,
          }),
        ),
      ),
    ),
})

const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300))
const Body = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8000))

export const readTools: ReadonlyArray<ReadTool> = [
  readTool({
    name: "search_workspace",
    description: "Search tasks, docs, events and channels the user can see.",
    input: Schema.Struct({ query: Schema.String.check(Schema.isMinLength(1)) }),
    run: Commands.searchWorkspace,
  }),
  readTool({
    name: "my_tasks",
    description: "List the tasks assigned to the user.",
    input: Schema.Struct({}),
    run: () => Commands.myTasks(),
  }),
  readTool({
    name: "get_task",
    description: "Read one task with its description, status and links.",
    input: Schema.Struct({ taskId: TaskId }),
    run: Commands.getTask,
  }),
  readTool({
    name: "get_doc",
    description: "Read a document's metadata and its current text.",
    input: Schema.Struct({ docId: DocId }),
    run: Commands.getDocById,
  }),
  readTool({
    name: "list_events",
    description: "List calendar events in a time range (ISO 8601 dates).",
    input: Schema.Struct({ from: Schema.String, to: Schema.String }),
    run: Commands.listEvents,
  }),
  readTool({
    name: "whoami",
    description: "Return the user's profile and workspace role.",
    input: Schema.Struct({}),
    run: () => Commands.whoami(),
  }),
]

export const writeTools: ReadonlyArray<WriteTool> = [
  writeTool({
    name: "create_task",
    description: "Propose creating a task in a board column. Needs a person's approval.",
    input: Schema.Struct({
      columnId: ColumnId,
      title: Title,
      description: Schema.optionalKey(Body),
    }),
    autoApprovable: false,
    prepare: Commands.createTaskRequest,
  }),
  writeTool({
    name: "update_task",
    description: "Propose changing a task's title or description.",
    input: Schema.Struct({
      taskId: TaskId,
      title: Schema.optionalKey(Title),
      description: Schema.optionalKey(Body),
    }),
    autoApprovable: false,
    prepare: Commands.updateTaskRequest,
  }),
  writeTool({
    name: "move_task",
    description: "Propose moving a task to another column.",
    input: Schema.Struct({ taskId: TaskId, columnId: ColumnId }),
    autoApprovable: false,
    prepare: Commands.moveTaskRequest,
  }),
  writeTool({
    name: "assign_task",
    description: "Propose assigning a task to people.",
    input: Schema.Struct({ taskId: TaskId, assignees: Schema.Array(UserId) }),
    autoApprovable: false,
    prepare: Commands.assignTaskRequest,
  }),
  writeTool({
    name: "link_entities",
    description: "Link two tasks. Low-risk: runs without approval if the user allows it.",
    input: Schema.Struct({ taskId: TaskId, targetId: TaskId, kind: RelationKind }),
    autoApprovable: true,
    prepare: Commands.linkTaskRequest,
  }),
  writeTool({
    name: "create_doc",
    description: "Propose creating a document under a parent.",
    input: Schema.Struct({ parentId: EntityId, title: Title }),
    autoApprovable: false,
    prepare: Commands.createDocRequest,
  }),
  writeTool({
    name: "create_event",
    description: "Propose creating a calendar event. Times are ISO 8601.",
    input: Schema.Struct({
      calendarId: CalendarId,
      title: Title,
      startsAt: Schema.String,
      endsAt: Schema.String,
    }),
    autoApprovable: false,
    prepare: Commands.createEventRequest,
  }),
  writeTool({
    name: "draft_message",
    description: "Post a message to a channel. Low-risk: runs without approval if allowed.",
    input: Schema.Struct({ channelId: ChannelId, text: Body }),
    autoApprovable: true,
    prepare: Commands.draftMessageRequest,
  }),
]

export const allTools: ReadonlyArray<AiTool> = [...readTools, ...writeTools]

export const findTool = (name: string): AiTool | undefined =>
  allTools.find((tool) => tool.name === name)

/** Tool definitions the model sees; parameters are the schemas the tools decode with. */
export const toolkit = Toolkit.make(
  ...allTools.map((tool) =>
    Tool.make(tool.name, {
      description: tool.description,
      parameters: tool.parameters,
      success: Schema.Unknown,
    }),
  ),
)
