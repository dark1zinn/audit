import {
  channels,
  comments,
  docs,
  entities,
  events,
  messages,
  projects,
  tasks,
  trailEvents,
} from "@audit/db/schema"
import { ReindexResult, ReindexStatus } from "@audit/domain/search/schema"
import { defineJob, Jobs } from "@audit/platform/jobs"
import { Db } from "@audit/platform/database"
import { desc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { record } from "../trail.ts"
import { channelSearchText, eventSearchText, projectSearchText, taskSearchText } from "./text.ts"

const Reindexed = Schema.Struct({ updated: Schema.Number })

/**
 * Recomputes `entities.search_text` for every indexed entity from its source table. Writing the
 * column fires the search trigger, so the tsvector also follows the current text-search config.
 */
export const reindexSearch = Command.make("search.reindex", {
  input: Schema.Struct({}),
  output: Reindexed,
  authorize: () =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireCapability("workspace.settings")
    }),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const rows: Array<{ id: (typeof entities.$inferSelect)["id"]; searchText: string }> = []

      const taskRows = yield* db
        .select({
          id: tasks.id,
          key: projects.key,
          number: tasks.number,
          description: tasks.description,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .pipe(Effect.orDie)
      for (const task of taskRows) {
        rows.push({
          id: task.id,
          searchText: taskSearchText(`${task.key}-${task.number}`, task.description),
        })
      }

      const projectRows = yield* db
        .select({ id: projects.id, key: projects.key, name: projects.name })
        .from(projects)
        .pipe(Effect.orDie)
      for (const project of projectRows) {
        rows.push({ id: project.id, searchText: projectSearchText(project.key, project.name) })
      }

      const channelRows = yield* db
        .select({ id: channels.id, name: channels.name, topic: channels.topic })
        .from(channels)
        .pipe(Effect.orDie)
      for (const channel of channelRows) {
        rows.push({ id: channel.id, searchText: channelSearchText(channel.name, channel.topic) })
      }

      const eventRows = yield* db
        .select({ id: events.id, description: events.description, location: events.location })
        .from(events)
        .pipe(Effect.orDie)
      for (const event of eventRows) {
        rows.push({
          id: event.id,
          searchText: eventSearchText(event.description, event.location),
        })
      }

      const messageRows = yield* db
        .select({ id: messages.id, bodyText: messages.bodyText })
        .from(messages)
        .pipe(Effect.orDie)
      for (const message of messageRows) rows.push({ id: message.id, searchText: message.bodyText })

      const commentRows = yield* db
        .select({ id: comments.id, bodyText: comments.bodyText })
        .from(comments)
        .pipe(Effect.orDie)
      for (const comment of commentRows) rows.push({ id: comment.id, searchText: comment.bodyText })

      const docRows = yield* db
        .select({ id: docs.id, contentText: docs.contentText })
        .from(docs)
        .pipe(Effect.orDie)
      for (const doc of docRows) rows.push({ id: doc.id, searchText: doc.contentText })

      yield* Effect.forEach(
        rows,
        (row) =>
          db
            .update(entities)
            .set({ searchText: row.searchText })
            .where(eq(entities.id, row.id))
            .pipe(Effect.orDie),
        { concurrency: 8, discard: true },
      )
      yield* record({ action: "search.reindexed", details: { updated: rows.length } })
      return { updated: rows.length }
    }),
})

/** The reindex runs in the background; the request command only queues it. */
export const reindexJob = defineJob("search.reindex", Schema.Struct({}))

/** Queues one reindex; a second request while one is waiting is absorbed by the singleton key. */
export const requestReindex = Command.make("search.reindex.request", {
  input: Schema.Struct({}),
  output: ReindexResult,
  authorize: () =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireCapability("workspace.settings")
    }),
  run: () =>
    Effect.gen(function* () {
      const jobs = yield* Jobs
      yield* record({ action: "search.reindex_requested" })
      yield* jobs.enqueue(reindexJob, {}, { singletonKey: "search.reindex" })
      return { queued: true as const }
    }),
})

/**
 * The latest request and completion, read from the trail. Queued until a completion recorded after
 * the latest request exists.
 */
export const reindexStatus = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("workspace.settings")
  const db = yield* Db
  const latest = (action: string) =>
    db
      .select({
        seq: trailEvents.seq,
        at: trailEvents.at,
        updated: sql<number | null>`(${trailEvents.meta}->'details'->>'updated')::int`,
      })
      .from(trailEvents)
      .where(eq(trailEvents.action, action))
      .orderBy(desc(trailEvents.seq))
      .limit(1)
      .pipe(Effect.orDie)
  const [requested] = yield* latest("search.reindex_requested")
  const [done] = yield* latest("search.reindexed")
  if (requested === undefined) {
    const idle: ReindexStatus = {
      state: "idle",
      requestedAt: null,
      completedAt: null,
      updated: null,
    }
    return idle
  }
  if (done !== undefined && done.seq > requested.seq) {
    const finished: ReindexStatus = {
      state: "done",
      requestedAt: requested.at,
      completedAt: done.at,
      updated: done.updated,
    }
    return finished
  }
  const queued: ReindexStatus = {
    state: "queued",
    requestedAt: requested.at,
    completedAt: null,
    updated: null,
  }
  return queued
})
