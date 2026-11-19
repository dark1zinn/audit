import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cleanupOrphanedFiles } from "@audit/core/files/cleanup"
import { purgeFile, uploadFile } from "@audit/core/files/commands"
import { openFile } from "@audit/core/files/queries"
import { createProject } from "@audit/core/projects/commands"
import { softDeleteEntity } from "@audit/core/entities"
import { system } from "@audit/testkit/fixtures"
import type { EntityId, ProjectId } from "@audit/domain/ids"
import { BlobStore } from "@audit/platform/blob-store"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Effect, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let guest: Person
let projectId: ProjectId

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%fake body\n")

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) =>
          typeof error === "object" && error !== null && "_tag" in error
            ? String(error._tag)
            : "unknown",
        ),
        Option.getOrElse(() => "defect"),
      )
    : "success"

const upload = (by: Person, bytes: Uint8Array, name: string) =>
  runAs(database, by.actor)(uploadFile.execute({ parentId: projectId as EntityId, name, bytes }))

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  guest = await addPerson(database, owner, "Guest", "guest")
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "FILESA", name: "Files", visibility: "restricted" }))
  projectId = project.id as ProjectId
}, 30_000)

afterAll(() => database.drop())

describe("file upload", () => {
  test("an editor uploads and the MIME type is sniffed from the bytes", async () => {
    const ref = await upload(owner, PDF_BYTES, "report.png")
    expect(ref.mime).toBe("application/pdf")
    expect(ref.name).toBe("report.png")
    expect(ref.size).toBe(PDF_BYTES.byteLength)
    expect(ref.url).toBe(`/files/${ref.id}`)
    expect(ref.thumbnailUrl).toBeNull()
  })

  test("the stored bytes read back intact through openFile", async () => {
    const ref = await upload(owner, PDF_BYTES, "round-trip.pdf")
    const opened = await runAs(database, owner.actor)(openFile(ref.id, "original"))
    expect(opened.mime).toBe("application/pdf")
    expect(new Uint8Array(await opened.body.arrayBuffer())).toEqual(PDF_BYTES)
  })

  test("an empty file is rejected as a validation error", async () => {
    const exit = await exitAs(
      database,
      owner.actor,
    )(
      uploadFile.execute({
        parentId: projectId as EntityId,
        name: "empty.txt",
        bytes: new Uint8Array(),
      }),
    )
    expect(failureTag(exit)).toBe("ValidationError")
  })

  test("a user outside the project cannot upload", async () => {
    const exit = await exitAs(
      database,
      guest.actor,
    )(uploadFile.execute({ parentId: projectId as EntityId, name: "x.txt", bytes: PDF_BYTES }))
    expect(failureTag(exit)).not.toBe("success")
  })
})

describe("file download", () => {
  test("an outsider cannot open a file on a restricted project", async () => {
    const ref = await upload(owner, PDF_BYTES, "private.pdf")
    const exit = await exitAs(database, guest.actor)(openFile(ref.id, "original"))
    expect(failureTag(exit)).toBe("NotFound")
  })

  test("a missing thumbnail is a NotFound, not a crash", async () => {
    const ref = await upload(owner, PDF_BYTES, "nothumb.pdf")
    const exit = await exitAs(database, owner.actor)(openFile(ref.id, "thumbnail"))
    expect(failureTag(exit)).toBe("NotFound")
  })
})

describe("file purge and orphan cleanup", () => {
  test("only the system actor may purge, and purge removes the row", async () => {
    const ref = await upload(owner, PDF_BYTES, "purge-me.pdf")
    const denied = await exitAs(database, owner.actor)(purgeFile.execute({ fileId: ref.id }))
    expect(failureTag(denied)).toBe("Forbidden")

    const removed = await runAs(database, system)(purgeFile.execute({ fileId: ref.id }))
    expect(removed.storageKey).toBe(`originals/${ref.id}`)
    expect(removed.thumbnailKey).toBeNull()
    const gone = await exitAs(database, owner.actor)(openFile(ref.id, "original"))
    expect(failureTag(gone)).toBe("NotFound")
  })

  test("cleanup marks files of a deleted parent, and purges them past retention", async () => {
    const parent = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "FILESB", name: "Doomed", visibility: "workspace" }))
    const doomedId = parent.id as ProjectId
    const ref = await runAs(
      database,
      owner.actor,
    )(uploadFile.execute({ parentId: doomedId as EntityId, name: "doomed.pdf", bytes: PDF_BYTES }))
    await runAs(database, system)(softDeleteEntity(doomedId as EntityId))

    // First pass only stamps the file; it is not yet past the retention window.
    const first = await runAs(database, system)(cleanupOrphanedFiles)
    expect(first.purged).toBe(0)
    const [row] = await database.superuser`
      select unreferenced_at from files where id = ${ref.id}`
    expect(row.unreferenced_at).not.toBeNull()

    // Backdate the stamp past retention; the next pass purges the row and its blob.
    await database.superuser`
      update files set unreferenced_at = now() - interval '8 days' where id = ${ref.id}`
    const second = await runAs(database, system)(cleanupOrphanedFiles)
    expect(second.purged).toBe(1)
    const blob = await database.runtime.runPromise(
      Effect.gen(function* () {
        const blobs = yield* BlobStore
        return yield* blobs.get(`originals/${ref.id}`)
      }),
    )
    expect(blob).toBeNull()
  })
})
