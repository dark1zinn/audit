import { Schema } from "effect"
import { BoardId, ColumnId, EntityId, LabelId, ProjectId, UserId } from "../ids.ts"
import { PrincipalType, ResourceRole } from "../roles.ts"

export const ProjectKey = Schema.String.check(Schema.isPattern(/^[A-Z]{2,6}$/))
export type ProjectKey = typeof ProjectKey.Type

export const ProjectName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
)

export const ProjectVisibility = Schema.Literals(["workspace", "restricted"])
export type ProjectVisibility = typeof ProjectVisibility.Type

/** `deleted` appears only in the admin list; regular lists hide deleted projects. */
export const ProjectStatus = Schema.Literals(["active", "archived", "deleted"])
export type ProjectStatus = typeof ProjectStatus.Type

export const ColumnCategory = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
])
export type ColumnCategory = typeof ColumnCategory.Type

export const Color = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))

/** A project as listed in the sidebar and admin console. */
export const ProjectSummary = Schema.Struct({
  id: ProjectId,
  key: ProjectKey,
  name: Schema.String,
  status: ProjectStatus,
  visibility: ProjectVisibility,
  memberRole: ResourceRole,
  /** The caller's effective role on the project; `null` when only metadata is visible. */
  myRole: Schema.NullOr(ResourceRole),
  /** Admins see restricted projects as metadata only: no name and no boards. */
  metadataOnly: Schema.Boolean,
  defaultBoardId: Schema.NullOr(BoardId),
  version: Schema.Int,
})
export type ProjectSummary = typeof ProjectSummary.Type

export const ProjectDetail = Schema.Struct({
  ...ProjectSummary.fields,
  leadUserId: Schema.NullOr(UserId),
  taskCount: Schema.Int,
  openTaskCount: Schema.Int,
  archivedAt: Schema.NullOr(Schema.Date),
})
export type ProjectDetail = typeof ProjectDetail.Type

export const CreateProjectInput = Schema.Struct({
  key: ProjectKey,
  name: ProjectName,
  visibility: Schema.optionalKey(ProjectVisibility),
  memberRole: Schema.optionalKey(ResourceRole),
})
export type CreateProjectInput = typeof CreateProjectInput.Type

export const UpdateProjectInput = Schema.Struct({
  name: Schema.optionalKey(ProjectName),
  leadUserId: Schema.optionalKey(Schema.NullOr(UserId)),
  visibility: Schema.optionalKey(ProjectVisibility),
  memberRole: Schema.optionalKey(ResourceRole),
  version: Schema.optionalKey(Schema.Int),
})
export type UpdateProjectInput = typeof UpdateProjectInput.Type

/** Typed confirmation: the caller must send the project key to delete it. */
export const DeleteProjectInput = Schema.Struct({ confirm: ProjectKey })
export type DeleteProjectInput = typeof DeleteProjectInput.Type

export const PrincipalInput = Schema.Struct({
  principalType: PrincipalType,
  /** A user or team id, or a workspace role name when `principalType` is `role`. */
  principalId: Schema.String,
  role: ResourceRole,
})
export type PrincipalInput = typeof PrincipalInput.Type

export const RevokeAccessInput = Schema.Struct({
  principalType: PrincipalType,
  principalId: Schema.String,
})
export type RevokeAccessInput = typeof RevokeAccessInput.Type

export const SetRestrictedInput = Schema.Struct({ restricted: Schema.Boolean })
export type SetRestrictedInput = typeof SetRestrictedInput.Type

// --- Boards and columns ---------------------------------------------------

export const BoardColumn = Schema.Struct({
  id: ColumnId,
  boardId: BoardId,
  name: Schema.String,
  category: ColumnCategory,
  position: Schema.String,
  wipLimit: Schema.NullOr(Schema.Int),
  /** Number of tasks currently in the column. */
  taskCount: Schema.Int,
})
export type BoardColumn = typeof BoardColumn.Type

export const Board = Schema.Struct({
  id: BoardId,
  projectId: ProjectId,
  name: Schema.String,
  position: Schema.String,
  restricted: Schema.Boolean,
  columns: Schema.Array(BoardColumn),
  version: Schema.Int,
})
export type Board = typeof Board.Type

export const CreateBoardInput = Schema.Struct({ name: ProjectName })
export type CreateBoardInput = typeof CreateBoardInput.Type

export const RenameBoardInput = Schema.Struct({
  name: ProjectName,
  version: Schema.optionalKey(Schema.Int),
})
export type RenameBoardInput = typeof RenameBoardInput.Type

export const SetBoardRestrictedInput = Schema.Struct({ restricted: Schema.Boolean })
export type SetBoardRestrictedInput = typeof SetBoardRestrictedInput.Type

export const CreateColumnInput = Schema.Struct({
  name: ProjectName,
  category: ColumnCategory,
  /** Insert after this column; omitted appends at the end. */
  afterColumnId: Schema.optionalKey(Schema.NullOr(ColumnId)),
  wipLimit: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 }))),
  ),
})
export type CreateColumnInput = typeof CreateColumnInput.Type

export const UpdateColumnInput = Schema.Struct({
  name: Schema.optionalKey(ProjectName),
  category: Schema.optionalKey(ColumnCategory),
  wipLimit: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 }))),
  ),
})
export type UpdateColumnInput = typeof UpdateColumnInput.Type

/** Moves a column by placing it after `afterColumnId` (or first when `null`). */
export const MoveColumnInput = Schema.Struct({ afterColumnId: Schema.NullOr(ColumnId) })
export type MoveColumnInput = typeof MoveColumnInput.Type

/** Tasks in a deleted column move to `moveTasksTo`; required when the column is not empty. */
export const DeleteColumnInput = Schema.Struct({
  moveTasksTo: Schema.optionalKey(Schema.NullOr(ColumnId)),
})
export type DeleteColumnInput = typeof DeleteColumnInput.Type

// --- Labels ---------------------------------------------------------------

export const Label = Schema.Struct({
  id: LabelId,
  projectId: ProjectId,
  name: Schema.String,
  color: Color,
})
export type Label = typeof Label.Type

export const CreateLabelInput = Schema.Struct({ name: ProjectName, color: Color })
export type CreateLabelInput = typeof CreateLabelInput.Type

export const UpdateLabelInput = Schema.Struct({
  name: Schema.optionalKey(ProjectName),
  color: Schema.optionalKey(Color),
})
export type UpdateLabelInput = typeof UpdateLabelInput.Type

/** Used by the access list shown in project settings. */
export const AccessEntry = Schema.Struct({
  resourceId: EntityId,
  principalType: PrincipalType,
  principalId: Schema.String,
  /** Display name: user name, team name, or the workspace role label. */
  principalName: Schema.String,
  role: ResourceRole,
})
export type AccessEntry = typeof AccessEntry.Type
