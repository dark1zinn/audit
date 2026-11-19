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
  .annotateMerge(OpenApi.annotations({ title: "audit API", version: "1.0.0" }))
