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
import { NotificationsApi } from "./notifications/api.ts"
import { TasksApi } from "./tasks/api.ts"
import { TrailApi } from "./trail/api.ts"
import { ChatApi } from "./chat/api.ts"
import { CalendarApi } from "./calendar/api.ts"
import { AdminApi, SignupApi } from "./admin/api.ts"
import { PeopleApi } from "./people/api.ts"
import { SearchApi } from "./search/api.ts"

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
  .add(ChatApi)
  .add(CalendarApi)
  .add(AdminApi)
  .add(SignupApi)
  .add(PeopleApi)
  .add(SearchApi)
  .annotateMerge(OpenApi.annotations({ title: "audit API", version: "1.0.0" }))
