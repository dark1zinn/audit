import { Schema } from "effect"
import {
  BoardId,
  ColumnId,
  CommentId,
  EntityId,
  LabelId,
  ProjectId,
  TaskId,
  UserId,
} from "../ids.ts"
import { ResourceRole } from "../roles.ts"
import { ColumnCategory, ProjectKey } from "../projects/schema.ts"

export const Priority = Schema.Literals(["none", "low", "medium", "high", "urgent"])
export type Priority = typeof Priority.Type

/** Rich text stored as Tiptap JSON. */
export const RichDoc = Schema.Record(Schema.String, Schema.Unknown)
export type RichDoc = typeof RichDoc.Type

export const TaskTitle = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(300),
)

export const Estimate = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))

export const RelationKind = Schema.Literals(["blocks", "relates", "duplicates"])
export type RelationKind = typeof RelationKind.Type

/** Card data for boards, lists, "my tasks" and the calendar. */
export const TaskCard = Schema.Struct({
  id: TaskId,
  /** Human key, e.g. `OPS-42`. */
  key: Schema.String,
  projectId: ProjectId,
  projectKey: ProjectKey,
  boardId: BoardId,
  columnId: ColumnId,
  columnCategory: ColumnCategory,
  title: Schema.String,
  priority: Priority,
  position: Schema.String,
  assignees: Schema.Array(UserId),
  labels: Schema.Array(LabelId),
  parentId: Schema.NullOr(TaskId),
  startAt: Schema.NullOr(Schema.Date),
  dueAt: Schema.NullOr(Schema.Date),
  estimate: Schema.NullOr(Schema.Int),
  completedAt: Schema.NullOr(Schema.Date),
  subtaskCount: Schema.Int,
  subtasksDone: Schema.Int,
  commentCount: Schema.Int,
  version: Schema.Int,
  updatedAt: Schema.Date,
})
export type TaskCard = typeof TaskCard.Type

export const BoardView = Schema.Struct({
  boardId: BoardId,
  columns: Schema.Array(
    Schema.Struct({
      id: ColumnId,
      name: Schema.String,
      category: ColumnCategory,
      position: Schema.String,
      wipLimit: Schema.NullOr(Schema.Int),
      /** Set when the column is over its WIP limit; a warning, never a block. */
      overWipLimit: Schema.Boolean,
      tasks: Schema.Array(TaskCard),
    }),
  ),
})
export type BoardView = typeof BoardView.Type

/** Filters shared by board, list, calendar and saved filters. Empty fields match everything. */
export const TaskFilter = Schema.Struct({
  assigneeId: Schema.optionalKey(UserId),
  labelId: Schema.optionalKey(LabelId),
  priority: Schema.optionalKey(Priority),
  category: Schema.optionalKey(ColumnCategory),
  /** ISO date strings; `dueBefore` is exclusive and `dueAfter` inclusive. */
  dueAfter: Schema.optionalKey(Schema.String),
  dueBefore: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  /** Tasks where the caller is an assignee or was @mentioned. */
  mentionsMe: Schema.optionalKey(Schema.Boolean),
})
export type TaskFilter = typeof TaskFilter.Type

export const TaskSortField = Schema.Literals([
  "position",
  "priority",
  "dueAt",
  "updatedAt",
  "number",
])
export const TaskGroupField = Schema.Literals(["none", "column", "assignee", "priority", "label"])

export const ListTasksQuery = Schema.Struct({
  ...TaskFilter.fields,
  sort: Schema.optionalKey(TaskSortField),
  sortDir: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
  groupBy: Schema.optionalKey(TaskGroupField),
})
export type ListTasksQuery = typeof ListTasksQuery.Type

export const TaskGroup = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  tasks: Schema.Array(TaskCard),
})
export type TaskGroup = typeof TaskGroup.Type

export const TaskListResult = Schema.Struct({ groups: Schema.Array(TaskGroup) })
export type TaskListResult = typeof TaskListResult.Type

export const CalendarItem = Schema.Struct({
  id: TaskId,
  key: Schema.String,
  title: Schema.String,
  dueAt: Schema.Date,
  startAt: Schema.NullOr(Schema.Date),
  columnCategory: ColumnCategory,
  assignees: Schema.Array(UserId),
})
export type CalendarItem = typeof CalendarItem.Type

export const CalendarQuery = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  ...TaskFilter.fields,
})
export type CalendarQuery = typeof CalendarQuery.Type

// --- Task detail -----------------------------------------------------------

export const Relation = Schema.Struct({
  kind: RelationKind,
  /** `outgoing`: this task blocks/relates/duplicates the target. */
  direction: Schema.Literals(["outgoing", "incoming"]),
  targetId: EntityId,
  key: Schema.NullOr(Schema.String),
  /** `null` when the target is restricted for the caller; the title is never sent. */
  title: Schema.NullOr(Schema.String),
  restricted: Schema.Boolean,
})
export type Relation = typeof Relation.Type

export const Comment = Schema.Struct({
  id: CommentId,
  taskId: TaskId,
  authorId: UserId,
  body: RichDoc,
  bodyText: Schema.String,
  anchor: Schema.NullOr(RichDoc),
  parentCommentId: Schema.NullOr(CommentId),
  resolvedAt: Schema.NullOr(Schema.Date),
  editedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  version: Schema.Int,
})
export type Comment = typeof Comment.Type

export const ActivityEntry = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  actorId: Schema.NullOr(UserId),
  createdAt: Schema.Date,
  diff: Schema.NullOr(Schema.Unknown),
})
export type ActivityEntry = typeof ActivityEntry.Type

export const TaskDetail = Schema.Struct({
  ...TaskCard.fields,
  description: Schema.NullOr(RichDoc),
  creatorId: Schema.NullOr(UserId),
  watching: Schema.Boolean,
  watchers: Schema.Array(UserId),
  relations: Schema.Array(Relation),
  comments: Schema.Array(Comment),
  activity: Schema.Array(ActivityEntry),
  /** The caller's effective role on the task's board; drives which controls the UI shows. */
  myRole: ResourceRole,
})
export type TaskDetail = typeof TaskDetail.Type

// --- Task commands ---------------------------------------------------------

export const CreateTaskInput = Schema.Struct({
  title: TaskTitle,
  description: Schema.optionalKey(Schema.NullOr(RichDoc)),
  priority: Schema.optionalKey(Priority),
  /** Defaults to the first column of the board. */
  columnId: Schema.optionalKey(ColumnId),
  startAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  dueAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  estimate: Schema.optionalKey(Schema.NullOr(Estimate)),
  assignees: Schema.optionalKey(Schema.Array(UserId)),
  labels: Schema.optionalKey(Schema.Array(LabelId)),
  parentId: Schema.optionalKey(Schema.NullOr(TaskId)),
})
export type CreateTaskInput = typeof CreateTaskInput.Type

export const UpdateTaskInput = Schema.Struct({
  title: Schema.optionalKey(TaskTitle),
  description: Schema.optionalKey(Schema.NullOr(RichDoc)),
  priority: Schema.optionalKey(Priority),
  startAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  dueAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  estimate: Schema.optionalKey(Schema.NullOr(Estimate)),
  assignees: Schema.optionalKey(Schema.Array(UserId)),
  labels: Schema.optionalKey(Schema.Array(LabelId)),
  parentId: Schema.optionalKey(Schema.NullOr(TaskId)),
  /** Optimistic concurrency: rejected with Conflict when the task changed since this version. */
  version: Schema.optionalKey(Schema.Int),
})
export type UpdateTaskInput = typeof UpdateTaskInput.Type

/** `afterTaskId` places the card after that card in the target column; `null` puts it first. */
export const MoveTaskInput = Schema.Struct({
  columnId: ColumnId,
  afterTaskId: Schema.NullOr(TaskId),
  version: Schema.optionalKey(Schema.Int),
})
export type MoveTaskInput = typeof MoveTaskInput.Type

export const DeleteTaskInput = Schema.Struct({ version: Schema.optionalKey(Schema.Int) })
export type DeleteTaskInput = typeof DeleteTaskInput.Type

export const BulkMoveInput = Schema.Struct({ taskIds: Schema.Array(TaskId), columnId: ColumnId })
export type BulkMoveInput = typeof BulkMoveInput.Type

export const BulkAssignInput = Schema.Struct({
  taskIds: Schema.Array(TaskId),
  add: Schema.Array(UserId),
  remove: Schema.Array(UserId),
})
export type BulkAssignInput = typeof BulkAssignInput.Type

export const BulkLabelInput = Schema.Struct({
  taskIds: Schema.Array(TaskId),
  add: Schema.Array(LabelId),
  remove: Schema.Array(LabelId),
})
export type BulkLabelInput = typeof BulkLabelInput.Type

export const BulkDeleteInput = Schema.Struct({ taskIds: Schema.Array(TaskId) })
export type BulkDeleteInput = typeof BulkDeleteInput.Type

export const LinkInput = Schema.Struct({ targetId: TaskId, kind: RelationKind })
export type LinkInput = typeof LinkInput.Type

// --- Comments --------------------------------------------------------------

export const CreateCommentInput = Schema.Struct({
  body: RichDoc,
  anchor: Schema.optionalKey(Schema.NullOr(RichDoc)),
  parentCommentId: Schema.optionalKey(Schema.NullOr(CommentId)),
})
export type CreateCommentInput = typeof CreateCommentInput.Type

export const UpdateCommentInput = Schema.Struct({
  body: Schema.optionalKey(RichDoc),
  resolved: Schema.optionalKey(Schema.Boolean),
  version: Schema.optionalKey(Schema.Int),
})
export type UpdateCommentInput = typeof UpdateCommentInput.Type

// --- Saved filters ---------------------------------------------------------

export const SavedFilter = Schema.Struct({
  id: EntityId,
  projectId: Schema.NullOr(ProjectId),
  name: Schema.String,
  filter: ListTasksQuery,
})
export type SavedFilter = typeof SavedFilter.Type

export const CreateSavedFilterInput = Schema.Struct({
  name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80)),
  filter: ListTasksQuery,
})
export type CreateSavedFilterInput = typeof CreateSavedFilterInput.Type
