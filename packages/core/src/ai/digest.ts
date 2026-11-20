/**
 * Weekly AI digest. A project opts in; each week the model summarizes the tasks that changed in
 * that project and posts the summary to its public channel. The post is attributed to the person
 * who turned the digest on, and marked as generated so readers can tell it apart.
 */
import { channels, entities, messages, projects, tasks } from "@audit/db/schema"
import { ChannelId, EntityId, MessageId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { visibleTo } from "../access.ts"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { createEntity } from "../entities.ts"
import { emit, record } from "../trail.ts"
import { generateStructured } from "./generate.ts"

export const aiDigestJob = defineJob("ai.digest", Schema.Struct({}))

/** Mondays at 09:00 UTC. */
export const AI_DIGEST_CRON = "0 9 * * 1"

/** Tasks changed within this window are summarized. */
const DIGEST_WINDOW_DAYS = 7

const MAX_ITEMS = 40

const Digest = Schema.Struct({ summary: Schema.String })

/** Turns the AI digest on or off for a project. Turning it on records who is the author. */
export const setAiDigest = Command.make("project.ai_digest.set", {
  input: Schema.Struct({ projectId: Schema.String, enabled: Schema.Boolean }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("project.settings", input.projectId as ProjectId)
    }),
  run: ({ projectId, enabled }) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("project.ai_digest.set")
      const db = yield* Db
      yield* db
        .update(projects)
        .set({
          aiDigest: enabled,
          aiDigestEnabledBy: enabled ? userId : null,
        })
        .where(eq(projects.id, projectId as ProjectId))
        .pipe(Effect.orDie)
      yield* record({
        action: enabled ? "project.ai_digest_enabled" : "project.ai_digest_disabled",
        entityId: projectId as ProjectId,
        entityType: "project",
        projectId: projectId as ProjectId,
      })
    }),
})

/**
 * Nothing from the task up to, but not including, its project is restricted. Restricted items keep
 * their own audience, so the public channel's readers may not see them even when the author can.
 * The project itself is excluded: its channel is already scoped to the project's members.
 */
const unrestrictedChain = (projectId: ProjectId) => sql`not exists (
  with recursive digest_chain as (
    select e.id, e.parent_id, e.restricted from entities e where e.id = ${entities.id}
    union all
    select p.id, p.parent_id, p.restricted
    from digest_chain c join entities p on p.id = c.parent_id
  )
  select 1 from digest_chain c where c.restricted and c.id <> ${projectId}
)`

/** Posts one project's digest. Runs as the system actor from the weekly job. */
export const postDigest = Command.make("ai.digest.post", {
  input: Schema.Struct({ projectId: Schema.String }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ projectId }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [project] = yield* db
        .select({
          id: projects.id,
          aiDigest: projects.aiDigest,
          enabledBy: projects.aiDigestEnabledBy,
        })
        .from(projects)
        .where(eq(projects.id, projectId as ProjectId))
        .pipe(Effect.orDie)
      if (project === undefined || !project.aiDigest || project.enabledBy === null) return
      const enabledBy = project.enabledBy as UserId
      const authz = yield* Authz
      if ((yield* authz.workspaceRole(enabledBy)) === null) return
      const [channel] = yield* db
        .select({ id: channels.id })
        .from(channels)
        .innerJoin(entities, eq(entities.id, channels.id))
        .where(
          and(
            eq(channels.projectId, project.id),
            eq(channels.kind, "public"),
            isNull(entities.deletedAt),
          ),
        )
        .orderBy(entities.createdAt)
        .limit(1)
        .pipe(Effect.orDie)
      if (channel === undefined) return
      const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      const changed = yield* db
        .select({ title: entities.title })
        .from(tasks)
        .innerJoin(entities, eq(entities.id, tasks.id))
        .where(
          and(
            eq(tasks.projectId, project.id),
            isNull(entities.deletedAt),
            gte(entities.updatedAt, since),
            visibleTo(enabledBy, sql`${entities.id}`),
            unrestrictedChain(project.id as ProjectId),
          ),
        )
        .orderBy(desc(entities.updatedAt))
        .limit(MAX_ITEMS)
        .pipe(Effect.orDie)
      if (changed.length === 0) return
      const prompt = [
        "Summarize this project's activity for the week in at most six short bullet points.",
        "Use only the items below. Do not invent work.",
        "",
        ...changed.map((item) => `- ${item.title}`),
      ].join("\n")
      const digest = yield* generateStructured(enabledBy, "summaries", prompt, Digest).pipe(
        Effect.catch((error) => Effect.logInfo("ai digest skipped", error).pipe(Effect.as(null))),
      )
      if (digest === null) return
      const messageId = Bun.randomUUIDv7() as MessageId
      const bodyText = digest.summary.trim()
      if (bodyText === "") return
      yield* createEntity({
        id: messageId as EntityId,
        type: "message",
        title: "",
        searchText: bodyText,
        parentId: channel.id as ChannelId,
        projectId: project.id as ProjectId,
      })
      yield* db
        .insert(messages)
        .values({
          id: messageId,
          channelId: channel.id as ChannelId,
          authorId: enabledBy,
          body: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
          },
          bodyText,
          generatedBy: "ai_digest",
        })
        .pipe(Effect.orDie)
      yield* emit({
        _tag: "MessageChanged",
        entityId: messageId as EntityId,
        projectId: project.id as ProjectId,
        actorId: enabledBy,
        version: 1,
        channelId: channel.id as ChannelId,
        messageId,
        kind: "created",
      })
    }),
})

/** Weekly run: posts a digest for every project that opted in. */
export const runAiDigests = Command.make("ai.digest.run", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const rows = yield* db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.aiDigest, true))
        .pipe(Effect.orDie)
      for (const row of rows) {
        yield* postDigest
          .execute({ projectId: row.id })
          .pipe(Effect.catchCause((cause) => Effect.logWarning("ai digest failed", cause)))
      }
    }),
})
