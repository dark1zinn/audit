/**
 * What each tool does, as typed calls. Reads use the same queries the UI uses. Writes build the
 * command input and a preview; `proposals` stores them.
 */
import { boardColumns, docs } from "@audit/db/schema"
import { NotFound, ValidationError } from "@audit/domain/errors"
import type { CalendarId, ChannelId, ColumnId, TaskId, UserId } from "@audit/domain/ids"
import { BoardId, DocId, EntityId } from "@audit/domain/ids"
import type { RelationKind } from "@audit/domain/tasks/schema"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { createEvent } from "../calendar/commands.ts"
import { listEvents as listEventsQuery } from "../calendar/queries.ts"
import { applyDocEdit, createDoc } from "../docs/commands.ts"
import { getDoc } from "../docs/queries.ts"
import { postMessage } from "../chat/commands.ts"
import { getMe } from "../identity/queries.ts"
import { retrieveContext } from "./retrieval.ts"
import { createTask, linkTask, moveTask, updateTask } from "../tasks/commands.ts"
import { myTasks as myTasksQuery, taskDetail } from "../tasks/queries.ts"
import type { ProposalDraft, ProposalPreview } from "./proposals.ts"
import { richDocFromText } from "./text.ts"
import { jsonToText } from "@audit/editor/text"
import { markdownToJson } from "@audit/editor/markdown"

// ---- read tools ----

export const searchWorkspace = (input: { readonly query: string }) =>
  retrieveContext(input.query, {}, { limit: 10 })

export const myTasks = () => myTasksQuery()

export const getTask = (input: { readonly taskId: TaskId }) => taskDetail(input.taskId)

export const getDocById = (input: { readonly docId: DocId }) => getDoc(input.docId)

export const listEvents = (input: { readonly from: string; readonly to: string }) =>
  listEventsQuery.execute({ from: input.from, to: input.to })

export const whoami = () => getMe

// ---- write tools ----

/** Encodes a typed command input as JSON, the form proposals are stored in. */
const encode = <I, IE>(schema: Schema.Codec<I, IE>, value: I) =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.mapError((error) => new ValidationError({ message: String(error) })),
  )

interface RequestSpec<I, IE> {
  readonly command: string
  readonly schema: Schema.Codec<I, IE>
  readonly input: I
  readonly preview: ProposalPreview
  readonly target: string
}

const request = <I, IE>(spec: RequestSpec<I, IE>) =>
  encode(spec.schema, spec.input).pipe(
    Effect.map((input): ProposalDraft => ({
      command: spec.command,
      input,
      preview: spec.preview,
      target: spec.target,
    })),
  )

const parseDate = (value: string, field: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? Effect.fail(new ValidationError({ message: `${field} is not an ISO 8601 date`, field }))
    : Effect.succeed(date)
}

export const createTaskRequest = (input: {
  readonly columnId: ColumnId
  readonly title: string
  readonly description?: string
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [column] = yield* db
      .select({ boardId: boardColumns.boardId })
      .from(boardColumns)
      .where(eq(boardColumns.id, input.columnId))
      .pipe(Effect.orDie)
    if (column === undefined) {
      return yield* new ValidationError({ message: "Unknown column", field: "columnId" })
    }
    return yield* request({
      command: "task.create",
      schema: createTask.input,
      input: {
        boardId: BoardId.make(column.boardId),
        columnId: input.columnId,
        title: input.title,
        ...(input.description === undefined
          ? {}
          : { description: richDocFromText(input.description) }),
      },
      preview: {
        summary: `Create task "${input.title}"`,
        fields: [{ label: "Title", value: input.title }],
      },
      target: input.columnId,
    })
  })

export const updateTaskRequest = (input: {
  readonly taskId: TaskId
  readonly title?: string
  readonly description?: string
}) =>
  request({
    command: "task.update",
    schema: updateTask.input,
    input: {
      taskId: input.taskId,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: richDocFromText(input.description) }),
    },
    preview: {
      summary: "Update task",
      fields: [
        ...(input.title === undefined ? [] : [{ label: "Title", value: input.title }]),
        ...(input.description === undefined
          ? []
          : [{ label: "Description", value: input.description }]),
      ],
    },
    target: input.taskId,
  })

export const moveTaskRequest = (input: { readonly taskId: TaskId; readonly columnId: ColumnId }) =>
  request({
    command: "task.move",
    schema: moveTask.input,
    input: { taskId: input.taskId, columnId: input.columnId, afterTaskId: null },
    preview: { summary: "Move task to another column", fields: [] },
    target: input.taskId,
  })

export const assignTaskRequest = (input: {
  readonly taskId: TaskId
  readonly assignees: ReadonlyArray<UserId>
}) =>
  request({
    command: "task.update",
    schema: updateTask.input,
    input: { taskId: input.taskId, assignees: [...input.assignees] },
    preview: {
      summary: "Assign task",
      fields: [{ label: "Assignees", value: input.assignees.join(", ") }],
    },
    target: input.taskId,
  })

export const linkTaskRequest = (input: {
  readonly taskId: TaskId
  readonly targetId: TaskId
  readonly kind: RelationKind
}) =>
  request({
    command: "task.link",
    schema: linkTask.input,
    input: { taskId: input.taskId, targetId: input.targetId, kind: input.kind },
    preview: {
      summary: `Link tasks (${input.kind})`,
      fields: [{ label: "Kind", value: input.kind }],
    },
    target: input.taskId,
  })

export const createDocRequest = (input: { readonly parentId: string; readonly title: string }) =>
  request({
    command: "doc.create",
    schema: createDoc.input,
    input: { parentId: EntityId.make(input.parentId), title: input.title },
    preview: {
      summary: `Create document "${input.title}"`,
      fields: [{ label: "Title", value: input.title }],
    },
    target: input.parentId,
  })

export const docEditRequest = (input: { readonly docId: string; readonly markdown: string }) =>
  Effect.gen(function* () {
    const docId = DocId.make(input.docId)
    const db = yield* Db
    const [row] = yield* db
      .select({ text: docs.contentText })
      .from(docs)
      .where(eq(docs.id, docId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "doc", id: docId })
    return yield* request({
      command: "doc.edit.apply",
      schema: applyDocEdit.input,
      input: { docId, markdown: input.markdown },
      preview: {
        summary: "Replace the document content",
        fields: [],
        diff: { before: row.text, after: jsonToText(markdownToJson(input.markdown)) },
      },
      target: input.docId,
    })
  })

export const createEventRequest = (input: {
  readonly calendarId: CalendarId
  readonly title: string
  readonly startsAt: string
  readonly endsAt: string
}) =>
  Effect.gen(function* () {
    const startsAt = yield* parseDate(input.startsAt, "startsAt")
    const endsAt = yield* parseDate(input.endsAt, "endsAt")
    return yield* request({
      command: "event.create",
      schema: createEvent.input,
      input: {
        calendarId: input.calendarId,
        title: input.title,
        startsAt,
        endsAt,
        allDay: false,
        timezone: "UTC",
        rrule: null,
        location: "",
        description: null,
        attendees: [],
        reminders: [],
      },
      preview: {
        summary: `Create event "${input.title}"`,
        fields: [
          { label: "Title", value: input.title },
          { label: "Starts", value: startsAt.toISOString() },
          { label: "Ends", value: endsAt.toISOString() },
        ],
      },
      target: input.calendarId,
    })
  })

export const draftMessageRequest = (input: {
  readonly channelId: ChannelId
  readonly text: string
}) =>
  request({
    command: "message.post",
    schema: postMessage.input,
    input: { channelId: input.channelId, body: richDocFromText(input.text) },
    preview: { summary: "Post message", fields: [{ label: "Message", value: input.text }] },
    target: input.channelId,
  })
