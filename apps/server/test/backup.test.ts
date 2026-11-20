import { createBackup, readManifest } from "../src/backup.ts"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { setupWorkspace } from "@audit/testkit/fixtures"
import { rm, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, test } from "bun:test"

let database: TestDatabase
let preKey: TestDatabase
let out: string

beforeAll(async () => {
  database = await makeTestDatabase()
  await setupWorkspace(database)
  // A schema from before the trail key, as an operator's database is before `audit migrate`.
  preKey = await makeTestDatabase()
  await preKey.superuser`drop table trail_key`
  out = await mkdtemp(join(tmpdir(), "audit-backup-test-"))
}, 120_000)

afterAll(async () => {
  await rm(out, { recursive: true, force: true })
  await database.drop()
  await preKey.drop()
})

test("the manifest records the trail head the dump contains", async () => {
  const [head] = await database.superuser<{ seq: number; hash: string }[]>`
    select seq::int as seq, hash from trail_events order by seq desc limit 1`
  const result = await createBackup({ config: database.config, out, recipients: [] })

  expect(result.manifest.trail).toEqual({ seq: head?.seq ?? -1, hash: head?.hash ?? "" })
  expect((await readManifest(result.dir)).trail).toEqual(result.manifest.trail ?? null)
})

test("a schema without the trail key records no trail head, so restore skips the check", async () => {
  const result = await createBackup({ config: preKey.config, out, recipients: [] })

  expect(result.manifest.trail).toBeUndefined()
  expect("trail" in (await readManifest(result.dir))).toBe(false)
})
