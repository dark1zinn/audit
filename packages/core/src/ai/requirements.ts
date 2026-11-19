/** Services a tool may need. Provided by the assistant turn and the job runner. */
import type { Authz } from "../authz.ts"
import type { EventBus } from "../event-bus.ts"
import type { CurrentActor } from "@audit/domain/actor"
import type { Db } from "@audit/platform/database"
import type { Jobs } from "@audit/platform/jobs"
import type { SqlClient } from "effect/sql"
import type { AiModels } from "./models.ts"
import type { Secrets } from "@audit/platform/crypto"

export type ToolRequirements =
  | AiModels
  | Secrets
  | Db
  | Authz
  | CurrentActor
  | Jobs
  | EventBus
  | SqlClient.SqlClient
