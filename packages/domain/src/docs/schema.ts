import { Schema } from "effect"
import { ResourceRole } from "../roles.ts"
import { PrincipalInput, RevokeAccessInput } from "../projects/schema.ts"
import { CommentId, DocId, DocVersionId, EntityId, ProjectId, UserId } from "../ids.ts"
import { RichDoc } from "../tasks/schema.ts"

/** The workspace-wide doc space: one `space` entity, created by migration. Parent of space docs. */
export const WORKSPACE_SPACE_ID = "018f0000-0000-7000-8000-000000000001" as EntityId

export const DocTitle = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(300),
)
export type DocTitle = typeof DocTitle.Type

/** An emoji or icon name; `null` clears it. */
export const DocIcon = Schema.NullOr(Schema.String.check(Schema.isMaxLength(64)))

/** One doc in a tree listing; the client nests them by `parentId`. */
export const DocNode = Schema.Struct({
  id: DocId,
  /** A project id, the space id, or the parent doc id. */
  parentId: EntityId,
  projectId: Schema.NullOr(ProjectId),
  title: Schema.String,
  icon: Schema.NullOr(Schema.String),
  position: Schema.String,
  restricted: Schema.Boolean,
  reviewEveryDays: Schema.NullOr(Schema.Int),
  ownerUserId: Schema.NullOr(UserId),
  verifiedAt: Schema.NullOr(Schema.Date),
  lastEditedAt: Schema.NullOr(Schema.Date),
  updatedAt: Schema.Date,
  version: Schema.Int,
})
export type DocNode = typeof DocNode.Type

export const DocDetail = Schema.Struct({
  ...DocNode.fields,
  /** The caller's effective role on this doc. */
  myRole: ResourceRole,
})
export type DocDetail = typeof DocDetail.Type

export const CreateDocInput = Schema.Struct({
  parentId: EntityId,
  title: DocTitle,
  icon: Schema.optionalKey(DocIcon),
  /** Place after this sibling; `null` puts it first; omitted puts it last. */
  afterId: Schema.optionalKey(Schema.NullOr(DocId)),
})
export type CreateDocInput = typeof CreateDocInput.Type

export const RenameDocInput = Schema.Struct({
  title: DocTitle,
  version: Schema.optionalKey(Schema.Int),
})
export type RenameDocInput = typeof RenameDocInput.Type

export const SetDocIconInput = Schema.Struct({
  icon: DocIcon,
  version: Schema.optionalKey(Schema.Int),
})
export type SetDocIconInput = typeof SetDocIconInput.Type

export const MoveDocInput = Schema.Struct({
  parentId: EntityId,
  /** Place after this sibling; `null` puts it first; omitted puts it last. */
  afterId: Schema.optionalKey(Schema.NullOr(DocId)),
  version: Schema.optionalKey(Schema.Int),
})
export type MoveDocInput = typeof MoveDocInput.Type

export const DeleteDocInput = Schema.Struct({ version: Schema.optionalKey(Schema.Int) })
export type DeleteDocInput = typeof DeleteDocInput.Type

export const SetDocRestrictedInput = Schema.Struct({
  restricted: Schema.Boolean,
  version: Schema.optionalKey(Schema.Int),
})
export type SetDocRestrictedInput = typeof SetDocRestrictedInput.Type

/** Freshness: how often the owner must verify the doc. `null` turns review off. */
export const SetDocReviewInput = Schema.Struct({
  reviewEveryDays: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3650 }))),
  ownerUserId: Schema.NullOr(UserId),
})
export type SetDocReviewInput = typeof SetDocReviewInput.Type

export const DocAccessInput = PrincipalInput
export type DocAccessInput = typeof DocAccessInput.Type

export const DocRevokeInput = RevokeAccessInput
export type DocRevokeInput = typeof DocRevokeInput.Type

export const VersionKind = Schema.Literals(["auto", "named", "restore"])
export type VersionKind = typeof VersionKind.Type

export const DocVersion = Schema.Struct({
  id: DocVersionId,
  docId: DocId,
  version: Schema.Int,
  label: Schema.NullOr(Schema.String),
  kind: VersionKind,
  createdBy: Schema.NullOr(UserId),
  createdAt: Schema.Date,
})
export type DocVersion = typeof DocVersion.Type

/** A version with its Tiptap JSON, for side-by-side diffs. */
export const DocVersionContent = Schema.Struct({
  ...DocVersion.fields,
  content: Schema.NullOr(RichDoc),
})
export type DocVersionContent = typeof DocVersionContent.Type

export const CreateVersionInput = Schema.Struct({
  label: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120)),
})
export type CreateVersionInput = typeof CreateVersionInput.Type

/** Anchored doc comment; text range is Yjs relative positions (base64) plus the quoted text. */
export const DocComment = Schema.Struct({
  id: CommentId,
  docId: DocId,
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
export type DocComment = typeof DocComment.Type

export const CreateDocCommentInput = Schema.Struct({
  body: RichDoc,
  anchor: Schema.optionalKey(Schema.NullOr(RichDoc)),
  parentCommentId: Schema.optionalKey(Schema.NullOr(CommentId)),
})
export type CreateDocCommentInput = typeof CreateDocCommentInput.Type

export const UpdateDocCommentInput = Schema.Struct({
  body: Schema.optionalKey(RichDoc),
  resolved: Schema.optionalKey(Schema.Boolean),
  version: Schema.optionalKey(Schema.Int),
})
export type UpdateDocCommentInput = typeof UpdateDocCommentInput.Type

export const ImportMarkdownInput = Schema.Struct({
  parentId: EntityId,
  title: Schema.optionalKey(DocTitle),
  markdown: Schema.String.check(Schema.isMaxLength(2_000_000)),
})
export type ImportMarkdownInput = typeof ImportMarkdownInput.Type

export const ExportFormat = Schema.Literals(["md", "html"])
export type ExportFormat = typeof ExportFormat.Type

/** Entity lookup for mention and link chips. Invisible entities come back `restricted`, untitled. */
export const EntityRef = Schema.Struct({
  id: EntityId,
  type: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
  restricted: Schema.Boolean,
  deleted: Schema.Boolean,
})
export type EntityRef = typeof EntityRef.Type

export const ResolveEntitiesInput = Schema.Struct({
  ids: Schema.Array(EntityId).check(Schema.isMaxLength(200)),
})
export type ResolveEntitiesInput = typeof ResolveEntitiesInput.Type

export const Backlink = Schema.Struct({
  sourceId: EntityId,
  sourceType: Schema.String,
  sourceTitle: Schema.String,
  kind: Schema.String,
  snippet: Schema.String,
  updatedAt: Schema.Date,
})
export type Backlink = typeof Backlink.Type

export const BacklinkGroup = Schema.Struct({
  type: Schema.String,
  items: Schema.Array(Backlink),
})
export type BacklinkGroup = typeof BacklinkGroup.Type
