import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  createProject,
  grantProjectAccess,
  setProjectRestricted,
} from "@audit/core/projects/commands"
import { projectAccess, sidebarProjects } from "@audit/core/projects/queries"
import { defaultBoardId } from "@audit/core/projects/read"
import { listTasks } from "@audit/core/tasks/queries"
import type { ProjectId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let member: Person
let guest: Person

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

const createAs = (actor: Person, key: string, visibility: "workspace" | "restricted") =>
  runAs(
    database,
    actor.actor,
  )(createProject.execute({ key, name: `Project ${key}`, visibility })).then((project) => ({
    projectId: project.id as ProjectId,
  }))

const visibleKeysFor = async (actor: Person) => {
  const projects = await runAs(database, actor.actor)(sidebarProjects())
  return projects.map((project) => project.id)
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")
  guest = await addPerson(database, owner, "Gus", "guest")
})

afterAll(() => database.drop())

describe("project creation side effects", () => {
  test("creator gets a manager grant and a default board", async () => {
    const { projectId } = await createAs(owner, "CREATE", "restricted")
    const access = await runAs(database, owner.actor)(projectAccess(projectId))
    expect(
      access.some((entry) => entry.principalType === "user" && entry.principalId === owner.userId),
    ).toBe(true)
    const boardId = await runAs(database, owner.actor)(defaultBoardId(projectId))
    expect(boardId).not.toBeNull()
  })

  test("workspace visibility gives members implicit access and excludes guests", async () => {
    const { projectId } = await createAs(owner, "WSVIS", "workspace")
    expect(await visibleKeysFor(member)).toContain(projectId)
    expect(await visibleKeysFor(guest)).not.toContain(projectId)
  })

  test("restricted visibility hides the project from members without a grant", async () => {
    const { projectId } = await createAs(owner, "RESTR", "restricted")
    expect(await visibleKeysFor(member)).not.toContain(projectId)
    expect(await visibleKeysFor(owner)).toContain(projectId)
  })
})

describe("guest access through an access entry", () => {
  test("a guest granted viewer sees the project and its tasks", async () => {
    const { projectId } = await createAs(owner, "GRANT", "restricted")
    expect(await visibleKeysFor(guest)).not.toContain(projectId)

    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: guest.userId,
        role: "viewer",
      }),
    )

    expect(await visibleKeysFor(guest)).toContain(projectId)
    const listed = await runAs(database, guest.actor)(listTasks(projectId, {}))
    expect(listed.groups).toBeDefined()
  })
})

describe("visibility change removes member access", () => {
  test("switching a workspace project to restricted removes member access", async () => {
    const { projectId } = await createAs(owner, "FLIP", "workspace")
    expect(await visibleKeysFor(member)).toContain(projectId)

    await runAs(
      database,
      owner.actor,
    )(setProjectRestricted.execute({ projectId, restricted: true }))

    expect(await visibleKeysFor(member)).not.toContain(projectId)
    const denied = await exitAs(database, member.actor)(listTasks(projectId, {}))
    expect(failureTag(denied)).toBe("NotFound")
  })
})
