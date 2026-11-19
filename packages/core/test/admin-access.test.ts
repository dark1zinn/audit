import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { accessItem, accessPerson } from "@audit/core/admin/queries"
import { createTeam, setTeamMember } from "@audit/core/identity/commands"
import {
  createBoard,
  createProject,
  grantBoardAccess,
  grantProjectAccess,
  setBoardRestricted,
} from "@audit/core/projects/commands"
import type { BoardId, ProjectId, TeamId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let ana: Person
let guest: Person
let projectId: ProjectId
let boardId: BoardId
let teamId: TeamId

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  ana = await addPerson(database, owner, "Ana", "member")
  guest = await addPerson(database, owner, "Guest", "guest")
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "ACCESS", name: "Access", visibility: "workspace" }))
  projectId = project.id as ProjectId
  const board = await runAs(
    database,
    owner.actor,
  )(createBoard.execute({ projectId, name: "Review" }))
  boardId = board.id
}, 60_000)

afterAll(() => database.drop())

describe("access review", () => {
  test("a project grant is inherited by an unrestricted board", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: ana.userId,
        role: "viewer",
      }),
    )
    const item = await runAs(database, owner.actor)(accessItem(boardId))
    expect(item.restricted).toBe(false)
    expect(item.grants).toContainEqual(
      expect.objectContaining({
        entityId: projectId,
        principalType: "user",
        principalId: ana.userId,
        source: "inherited",
      }),
    )
  })

  test("a grant on the board itself is explained as direct", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      grantBoardAccess.execute({
        boardId,
        principalType: "user",
        principalId: ana.userId,
        role: "editor",
      }),
    )
    const item = await runAs(database, owner.actor)(accessItem(boardId))
    expect(item.grants).toContainEqual(
      expect.objectContaining({
        entityId: boardId,
        principalType: "user",
        principalId: ana.userId,
        role: "editor",
        source: "direct",
      }),
    )
  })

  test("a team grant is explained as team, for the item and for the person", async () => {
    const team = await runAs(
      database,
      owner.actor,
    )(createTeam.execute({ name: "Design", slug: "design" }))
    teamId = team
    await runAs(
      database,
      owner.actor,
    )(setTeamMember.execute({ teamId, userId: ana.userId, role: "member" }))
    await runAs(
      database,
      owner.actor,
    )(
      grantBoardAccess.execute({
        boardId,
        principalType: "team",
        principalId: teamId,
        role: "commenter",
      }),
    )

    const item = await runAs(database, owner.actor)(accessItem(boardId))
    expect(item.grants).toContainEqual(
      expect.objectContaining({
        entityId: boardId,
        principalType: "team",
        principalId: teamId,
        source: "team",
      }),
    )

    const person = await runAs(database, owner.actor)(accessPerson(ana.userId))
    expect(person.grants).toContainEqual(
      expect.objectContaining({
        entityId: boardId,
        principalType: "team",
        principalId: teamId,
        source: "team",
      }),
    )
  })

  test("a workspace role grant is explained as role, and the person's role is reported", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      grantBoardAccess.execute({
        boardId,
        principalType: "role",
        principalId: "guest",
        role: "viewer",
      }),
    )

    const item = await runAs(database, owner.actor)(accessItem(boardId))
    expect(item.grants).toContainEqual(
      expect.objectContaining({
        entityId: boardId,
        principalType: "role",
        principalRole: "guest",
        source: "role",
      }),
    )

    const person = await runAs(database, owner.actor)(accessPerson(guest.userId))
    expect(person.workspaceRole).toBe("guest")
    expect(person.grants).toContainEqual(
      expect.objectContaining({ entityId: boardId, principalType: "role", source: "role" }),
    )
  })

  test("a restricted board stops the project grant from flowing down", async () => {
    await runAs(database, owner.actor)(setBoardRestricted.execute({ boardId, restricted: true }))
    const item = await runAs(database, owner.actor)(accessItem(boardId))
    expect(item.restricted).toBe(true)
    expect(item.grants.some((grant) => grant.source === "inherited")).toBe(false)
    expect(item.grants.some((grant) => grant.source === "direct")).toBe(true)
  })

  test("a person's review explains container, team and restricted paths", async () => {
    const person = await runAs(database, owner.actor)(accessPerson(ana.userId))
    expect(person.grants).toContainEqual(
      expect.objectContaining({
        entityId: projectId,
        principalType: "user",
        scope: "container",
        restricted: false,
        restrictedChildren: 1,
        teamName: null,
      }),
    )
    expect(person.grants).toContainEqual(
      expect.objectContaining({
        entityId: boardId,
        principalType: "team",
        teamName: "Design",
        scope: "own",
        restricted: true,
        restrictedChildren: 0,
      }),
    )
  })
})
