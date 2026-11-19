import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { BoardId, CommentId, EntityId, ProjectId, TaskId } from "../ids.ts"
import {
  BoardView,
  BulkAssignInput,
  BulkDeleteInput,
  BulkLabelInput,
  BulkMoveInput,
  CalendarItem,
  CalendarQuery,
  Comment,
  CreateCommentInput,
  CreateSavedFilterInput,
  CreateTaskInput,
  DeleteTaskInput,
  LinkInput,
  ListTasksQuery,
  MoveTaskInput,
  SavedFilter,
  TaskCard,
  TaskDetail,
  TaskListResult,
  UpdateCommentInput,
  UpdateTaskInput,
} from "./schema.ts"

const taskParams = { params: { taskId: TaskId } }
const boardParams = { params: { boardId: BoardId } }
const projectParams = { params: { projectId: ProjectId } }

/** Board, list, calendar, and "my tasks" reads plus task writes. */
export const TasksApi = HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("board", "/api/boards/:boardId/view", {
      ...boardParams,
      query: ListTasksQuery,
      success: BoardView,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/tasks", {
      ...projectParams,
      query: ListTasksQuery,
      success: TaskListResult,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("calendar", "/api/projects/:projectId/calendar", {
      ...projectParams,
      query: CalendarQuery,
      success: Schema.Array(CalendarItem),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("mine", "/api/me/tasks", {
      success: Schema.Array(TaskCard),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/tasks/:taskId", {
      ...taskParams,
      success: TaskDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("byNumber", "/api/projects/:projectId/tasks/by-number/:number", {
      params: { projectId: ProjectId, number: Schema.NumberFromString.check(Schema.isInt()) },
      success: TaskDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("subtasks", "/api/tasks/:taskId/subtasks", {
      ...taskParams,
      success: Schema.Array(TaskCard),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/boards/:boardId/tasks", {
      ...boardParams,
      payload: CreateTaskInput,
      success: TaskCard,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", "/api/tasks/:taskId", {
      ...taskParams,
      payload: UpdateTaskInput,
      success: TaskCard,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("move", "/api/tasks/:taskId/move", {
      ...taskParams,
      payload: MoveTaskInput,
      success: TaskCard,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("delete", "/api/tasks/:taskId/delete", {
      ...taskParams,
      payload: DeleteTaskInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("bulkMove", "/api/tasks/bulk/move", {
      payload: BulkMoveInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("bulkAssign", "/api/tasks/bulk/assign", {
      payload: BulkAssignInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("bulkLabel", "/api/tasks/bulk/label", {
      payload: BulkLabelInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("bulkDelete", "/api/tasks/bulk/delete", {
      payload: BulkDeleteInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("link", "/api/tasks/:taskId/links", {
      ...taskParams,
      payload: LinkInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unlink", "/api/tasks/:taskId/links/remove", {
      ...taskParams,
      payload: LinkInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("watch", "/api/tasks/:taskId/watch", {
      ...taskParams,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unwatch", "/api/tasks/:taskId/unwatch", {
      ...taskParams,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createComment", "/api/tasks/:taskId/comments", {
      ...taskParams,
      payload: CreateCommentInput,
      success: Comment,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateComment", "/api/comments/:commentId", {
      params: { commentId: CommentId },
      payload: UpdateCommentInput,
      success: Comment,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteComment", "/api/comments/:commentId/delete", {
      params: { commentId: CommentId },
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("savedFilters", "/api/projects/:projectId/saved-filters", {
      ...projectParams,
      success: Schema.Array(SavedFilter),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createSavedFilter", "/api/projects/:projectId/saved-filters", {
      ...projectParams,
      payload: CreateSavedFilterInput,
      success: SavedFilter,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteSavedFilter", "/api/saved-filters/:filterId/delete", {
      params: { filterId: EntityId },
      error: CommandError,
    }),
  )
  .middleware(Authentication)
