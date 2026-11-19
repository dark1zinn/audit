import { HttpApi, OpenApi } from "effect/http-api"
import {
  InvitesApi,
  JoinApi,
  MeApi,
  MembersApi,
  SetupApi,
  TeamsApi,
  WorkspaceApi,
} from "./identity/api.ts"
import { BoardsApi, ProjectsApi } from "./projects/api.ts"
import { DocsApi, EntitiesApi } from "./docs/api.ts"
import { NotificationsApi, TasksApi } from "./tasks/api.ts"
import { TrailApi } from "./trail/api.ts"

/** The REST API served under `/api`, shared by the server and the typed web client. */
export const AuditApi = HttpApi.make("audit")
  .add(SetupApi)
  .add(JoinApi)
  .add(MeApi)
  .add(WorkspaceApi)
  .add(MembersApi)
  .add(InvitesApi)
  .add(TeamsApi)
  .add(TrailApi)
  .add(ProjectsApi)
  .add(BoardsApi)
  .add(TasksApi)
  .add(DocsApi)
  .add(EntitiesApi)
  .add(NotificationsApi)
  .annotateMerge(OpenApi.annotations({ title: "audit API", version: "1.0.0" }))
