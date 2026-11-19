import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { CommentId, DocId, DocVersionId, EntityId, ProjectId } from "../ids.ts"
import {
  BacklinkGroup,
  CreateDocCommentInput,
  CreateDocInput,
  CreateVersionInput,
  DeleteDocInput,
  DocAccessInput,
  DocComment,
  DocDetail,
  DocNode,
  DocRevokeInput,
  DocVersion,
  DocVersionContent,
  EntityRef,
  ImportMarkdownInput,
  MoveDocInput,
  RenameDocInput,
  ResolveEntitiesInput,
  SetDocIconInput,
  SetDocRestrictedInput,
  SetDocReviewInput,
  UpdateDocCommentInput,
} from "./schema.ts"

const docParams = { params: { docId: DocId } }
const projectParams = { params: { projectId: ProjectId } }
const versionParams = { params: { docId: DocId, versionId: DocVersionId } }
const commentParams = { params: { commentId: CommentId } }
const markdown = HttpApiSchema.asText({ contentType: "text/markdown; charset=utf-8" })
const html = HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" })

/** Doc tree, doc content metadata, versions, doc comments, import/export. */
export const DocsApi = HttpApiGroup.make("docs")
  .add(
    HttpApiEndpoint.get("projectTree", "/api/projects/:projectId/docs", {
      ...projectParams,
      success: Schema.Array(DocNode),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("spaceTree", "/api/docs/space", {
      success: Schema.Array(DocNode),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/docs/:docId", {
      ...docParams,
      success: DocDetail,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/docs", {
      payload: CreateDocInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("import", "/api/docs/import", {
      payload: ImportMarkdownInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("rename", "/api/docs/:docId/rename", {
      ...docParams,
      payload: RenameDocInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setIcon", "/api/docs/:docId/icon", {
      ...docParams,
      payload: SetDocIconInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("move", "/api/docs/:docId/move", {
      ...docParams,
      payload: MoveDocInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("delete", "/api/docs/:docId/delete", {
      ...docParams,
      payload: DeleteDocInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setRestricted", "/api/docs/:docId/restricted", {
      ...docParams,
      payload: SetDocRestrictedInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setReview", "/api/docs/:docId/review", {
      ...docParams,
      payload: SetDocReviewInput,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("verify", "/api/docs/:docId/verify", {
      ...docParams,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("grant", "/api/docs/:docId/access", {
      ...docParams,
      payload: DocAccessInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("revoke", "/api/docs/:docId/access/revoke", {
      ...docParams,
      payload: DocRevokeInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("versions", "/api/docs/:docId/versions", {
      ...docParams,
      success: Schema.Array(DocVersion),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createVersion", "/api/docs/:docId/versions", {
      ...docParams,
      payload: CreateVersionInput,
      success: DocVersion,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("version", "/api/docs/:docId/versions/:versionId", {
      ...versionParams,
      success: DocVersionContent,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("restoreVersion", "/api/docs/:docId/versions/:versionId/restore", {
      ...versionParams,
      success: DocNode,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("comments", "/api/docs/:docId/comments", {
      ...docParams,
      success: Schema.Array(DocComment),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createComment", "/api/docs/:docId/comments", {
      ...docParams,
      payload: CreateDocCommentInput,
      success: DocComment,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateComment", "/api/doc-comments/:commentId", {
      ...commentParams,
      payload: UpdateDocCommentInput,
      success: DocComment,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteComment", "/api/doc-comments/:commentId/delete", {
      ...commentParams,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportMarkdown", "/api/docs/:docId/export/md", {
      ...docParams,
      success: Schema.String.pipe(markdown),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("exportHtml", "/api/docs/:docId/export/html", {
      ...docParams,
      success: Schema.String.pipe(html),
      error: CommandError,
    }),
  )
  .middleware(Authentication)

/** Entity lookups shared by every rich-text chip and the backlinks panel. */
export const EntitiesApi = HttpApiGroup.make("entities")
  .add(
    HttpApiEndpoint.post("resolve", "/api/entities/resolve", {
      payload: ResolveEntitiesInput,
      success: Schema.Record(Schema.String, EntityRef),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("backlinks", "/api/entities/:entityId/backlinks", {
      params: { entityId: EntityId },
      success: Schema.Array(BacklinkGroup),
      error: CommandError,
    }),
  )
  .middleware(Authentication)
