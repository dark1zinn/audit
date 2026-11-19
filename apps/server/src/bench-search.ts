#!/usr/bin/env bun
/**
 * `bun run bench:search`: runs 200 representative `search` and `quick` queries as a workspace
 * member against the configured database, prints p50/p95 latency, and exits non-zero when the
 * overall p95 is 200 ms or more. Run `audit seed --demo` first so the data volume is realistic.
 */
import * as queries from "@audit/core/search/queries"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type { UserId } from "@audit/domain/ids"
import { readAppConfig } from "@audit/platform/config"
import { Data, Effect, Layer, ManagedRuntime } from "effect"
import { SqlClient } from "effect/sql"
import { makeRandom } from "./seed-demo.ts"
import { makeCoreLayer } from "./server.ts"

/** The database has no workspace member to run the benchmark as. */
export class NoMember extends Data.TaggedError("NoMember")<{ readonly message: string }> {}

const TOTAL = 200
const P95_BUDGET_MS = 200
const TYPE_FILTERS = ["task", "doc", "channel", "event", "task,doc", "doc,channel"]
const TERMS = [
  "invoice",
  "billing export",
  "onboarding",
  "retry policy",
  "audit trail",
  "release",
  "incident",
  "roadmap",
  "budget",
  "calendar sync",
  "data retention",
  "metrics dashboard",
  "vendor review",
  "ENG-42",
  "OPS-7",
  "Runbook",
  "sprint",
  "customer",
  "forecast",
  "migration",
  "latency",
  "hiring",
  "security",
  "design",
]

const percentile = (sorted: ReadonlyArray<number>, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0

const summarize = (label: string, samples: ReadonlyArray<number>) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = percentile(sorted, 0.5)
  const p95 = percentile(sorted, 0.95)
  console.log(
    `${label.padEnd(8)} n=${sorted.length}  p50=${p50.toFixed(1)} ms  p95=${p95.toFixed(1)} ms`,
  )
  return p95
}

const memberActor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly id: UserId }>`
    select user_id as id from workspace_members where role = 'member' limit 1`
  const member = rows[0]
  if (member === undefined) {
    return yield* Effect.fail(
      new NoMember({ message: "no member found; run `audit seed --demo` first" }),
    )
  }
  const actor: Actor = { _tag: "user", userId: member.id, role: "member" }
  return actor
})

const timed = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const start = performance.now()
    yield* effect.pipe(Effect.orDie)
    return performance.now() - start
  })

const program = Effect.gen(function* () {
  const actor = yield* memberActor
  const rnd = makeRandom(7)
  const searchSamples: number[] = []
  const quickSamples: number[] = []
  for (let index = 0; index < TOTAL; index++) {
    const term = rnd.pick(TERMS)
    if (index % 2 === 0) {
      const types = rnd.next() < 0.5 ? undefined : rnd.pick(TYPE_FILTERS)
      const elapsed = yield* timed(
        queries.search
          .execute({ q: term, limit: 20, ...(types === undefined ? {} : { types }) })
          .pipe(Effect.provideService(CurrentActor, actor)),
      )
      searchSamples.push(elapsed)
    } else {
      const prefix = term.slice(0, 2 + rnd.int(term.length))
      const elapsed = yield* timed(
        queries.quick.execute({ q: prefix }).pipe(Effect.provideService(CurrentActor, actor)),
      )
      quickSamples.push(elapsed)
    }
  }
  return { searchSamples, quickSamples }
})

const config = await Effect.runPromise(readAppConfig)
const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
try {
  const { searchSamples, quickSamples } = await runtime.runPromise(program)
  summarize("search", searchSamples)
  summarize("quick", quickSamples)
  const overallP95 = summarize("overall", [...searchSamples, ...quickSamples])
  console.log(`budget: overall p95 must stay below ${P95_BUDGET_MS} ms`)
  process.exitCode = overallP95 >= P95_BUDGET_MS ? 1 : 0
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await runtime.dispose()
}
