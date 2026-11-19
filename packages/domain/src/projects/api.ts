import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { BoardId, ColumnId, LabelId, ProjectId } from "../ids.ts"
import {
  AccessEntry,
  Board,
  BoardColumn,
  CreateBoardInput,
  CreateColumnInput,
  CreateLabelInput,
  CreateProjectInput,
  DeleteColumnInput,
  DeleteProjectInput,
  Label,
  MoveColumnInput,
  PrincipalInput,
  ProjectDetail,
  ProjectSummary,
  RenameBoardInput,
  RevokeAccessInput,
  SetBoardRestrictedInput,
  SetRestrictedInput,
  UpdateColumnInput,
  UpdateLabelInput,
  UpdateProjectInput,
} from "./schema.ts"

const projectParams = { params: { projectId: ProjectId } }
const boardParams = { params: { boardId: BoardId } }

/** Projects: listing, lifecycle, and project-level access. */
export const ProjectsApi = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", "/api/projects", {
      success: Schema.Array(ProjectSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("adminList", "/api/admin/projects", {
      success: Schema.Array(ProjectSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/projects", {
      payload: CreateProjectInput,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/projects/:projectId", {
      ...projectParams,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", "/api/projects/:projectId", {
      ...projectParams,
      payload: UpdateProjectInput,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("archive", "/api/projects/:projectId/archive", {
      ...projectParams,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unarchive", "/api/projects/:projectId/unarchive", {
      ...projectParams,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("delete", "/api/projects/:projectId/delete", {
      ...projectParams,
      payload: DeleteProjectInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("restore", "/api/projects/:projectId/restore", {
      ...projectParams,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("access", "/api/projects/:projectId/access", {
      ...projectParams,
      success: Schema.Array(AccessEntry),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("grant", "/api/projects/:projectId/access", {
      ...projectParams,
      payload: PrincipalInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("revoke", "/api/projects/:projectId/access/revoke", {
      ...projectParams,
      payload: RevokeAccessInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setRestricted", "/api/projects/:projectId/restricted", {
      ...projectParams,
      payload: SetRestrictedInput,
      success: ProjectDetail,
      error: CommandError,
    }),
  )
  .middleware(Authentication)

/** Boards, their columns, board-level access, and labels (labels belong to a project). */
export const BoardsApi = HttpApiGroup.make("boards")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/boards", {
      ...projectParams,
      success: Schema.Array(Board),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/projects/:projectId/boards", {
      ...projectParams,
      payload: CreateBoardInput,
      success: Board,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/boards/:boardId", {
      ...boardParams,
      success: Board,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("rename", "/api/boards/:boardId", {
      ...boardParams,
      payload: RenameBoardInput,
      success: Board,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("delete", "/api/boards/:boardId/delete", {
      ...boardParams,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setRestricted", "/api/boards/:boardId/restricted", {
      ...boardParams,
      payload: SetBoardRestrictedInput,
      success: Board,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("grant", "/api/boards/:boardId/access", {
      ...boardParams,
      payload: PrincipalInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("revoke", "/api/boards/:boardId/access/revoke", {
      ...boardParams,
      payload: RevokeAccessInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createColumn", "/api/boards/:boardId/columns", {
      ...boardParams,
      payload: CreateColumnInput,
      success: BoardColumn,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateColumn", "/api/columns/:columnId", {
      params: { columnId: ColumnId },
      payload: UpdateColumnInput,
      success: BoardColumn,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("moveColumn", "/api/columns/:columnId/move", {
      params: { columnId: ColumnId },
      payload: MoveColumnInput,
      success: BoardColumn,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteColumn", "/api/columns/:columnId/delete", {
      params: { columnId: ColumnId },
      payload: DeleteColumnInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("labels", "/api/projects/:projectId/labels", {
      ...projectParams,
      success: Schema.Array(Label),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createLabel", "/api/projects/:projectId/labels", {
      ...projectParams,
      payload: CreateLabelInput,
      success: Label,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateLabel", "/api/labels/:labelId", {
      params: { labelId: LabelId },
      payload: UpdateLabelInput,
      success: Label,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteLabel", "/api/labels/:labelId/delete", {
      params: { labelId: LabelId },
      error: CommandError,
    }),
  )
  .middleware(Authentication)
