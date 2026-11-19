import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDoc, createDocVersion } from "@audit/core/docs/commands"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, EntityId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace, PASSWORD } from "@audit/testkit/fixtures"
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import * as Y from "yjs"
import { type RunningServer, startServer } from "../src/server.ts"

const FIELD = "default"
const TIMEOUT = 30_000

type AuthOutcome =
  | { readonly ok: true; readonly scope: string }
  | { readonly ok: false; readonly reason: string }

interface Client {
  readonly doc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly socket: HocuspocusProviderWebsocket
  readonly outcome: Promise<AuthOutcome>
}

let db: TestDatabase
let running: RunningServer
let origin: string
let wsUrl: string
let owner: Person
let editor: Person
let viewer: Person
let stranger: Person
let docId: DocId
let ownerCookie: string
let editorCookie: string
let viewerCookie: string
let strangerCookie: string
const clients: Client[] = []

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  probe.stop(true)
  return port
}

/** A WebSocket that carries the session cookie on the upgrade request. */
const cookieSocket = (cookie: string | null) =>
  class extends WebSocket {
    constructor(address: string | URL) {
      super(address, { headers: cookie ? { cookie } : {} })
    }
  }

const connect = (cookie: string | null, document = new Y.Doc()): Client => {
  const socket = new HocuspocusProviderWebsocket({
    url: wsUrl,
    WebSocketPolyfill: cookieSocket(cookie),
  })
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `doc:${docId}`,
    document,
  })
  provider.attach()
  const { promise: outcome, resolve } = Promise.withResolvers<AuthOutcome>()
  provider.on("authenticated", ({ scope }: { scope: unknown }) =>
    resolve({ ok: true, scope: String(scope) }),
  )
  provider.on("authenticationFailed", ({ reason }: { reason: string }) =>
    resolve({ ok: false, reason }),
  )
  const client = { doc: document, provider, socket, outcome }
  clients.push(client)
  return client
}

const signIn = async (email: string): Promise<string> => {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

const text = (document: Y.Doc) => document.getXmlFragment(FIELD).toString()

/** Appends a paragraph, as the editor would type it. */
const append = (document: Y.Doc, value: string) =>
  document.transact(() => {
    const fragment = document.getXmlFragment(FIELD)
    const paragraph = new Y.XmlElement("paragraph")
    paragraph.insert(0, [new Y.XmlText(value)])
    fragment.insert(fragment.length, [paragraph])
  })

// Store debounce (2 s in tests) has no client-side event, so the store is observed by polling the
// database over real time. Deterministic time control cannot drive the server's debounce timers.
const waitFor = async (check: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(25)
  }
}

/** The text persisted by the store, read as the superuser so RLS does not hide it. */
const stored = async (): Promise<string> => {
  const rows = await db.superuser<
    { content_text: string }[]
  >`select content_text from docs where id = ${docId}`
  return rows[0]?.content_text ?? ""
}

beforeAll(async () => {
  db = await makeTestDatabase()
  const port = freePort()
  origin = `http://localhost:${port}`
  wsUrl = `ws://localhost:${port}/collab`
  running = await startServer({ ...db.config, port, url: new URL(origin) })

  owner = await setupWorkspace(db)
  editor = await addPerson(db, owner, "Edna", "member")
  viewer = await addPerson(db, owner, "Vic", "guest")
  stranger = await addPerson(db, owner, "Sam", "guest")

  const doc = await runAs(
    db,
    owner.actor,
  )(createDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, title: "Shared" }))
  docId = doc.id as DocId
  await db.superuser`insert into access_entries (resource_id, principal_type, principal_id, role, granted_by) values (${docId}, 'user', ${editor.userId}, 'editor', ${owner.userId})`
  await db.superuser`insert into access_entries (resource_id, principal_type, principal_id, role, granted_by) values (${docId}, 'user', ${viewer.userId}, 'viewer', ${owner.userId})`
  await db.superuser`insert into access_entries (resource_id, principal_type, principal_id, role, granted_by) values (${docId}, 'user', ${owner.userId}, 'manager', ${owner.userId})`
  await db.superuser`update entities set restricted = true where id = ${docId}`

  ownerCookie = await signIn(owner.email)
  editorCookie = await signIn(editor.email)
  viewerCookie = await signIn(viewer.email)
  strangerCookie = await signIn(stranger.email)
})

afterAll(async () => {
  for (const client of clients) {
    client.provider.destroy()
    client.socket.destroy()
  }
  await running?.stop()
  await db?.drop()
})

describe("collab", () => {
  test(
    "editors converge on each other's edits",
    async () => {
      const a = connect(editorCookie)
      const b = connect(editorCookie)
      expect(await a.outcome).toEqual({ ok: true, scope: "read-write" })
      expect(await b.outcome).toEqual({ ok: true, scope: "read-write" })

      append(a.doc, "from A")
      append(b.doc, "from B")
      await waitFor(
        () =>
          [a.doc, b.doc].every((document) => {
            const content = text(document)
            return content.includes("from A") && content.includes("from B")
          }),
        "editors to converge",
      )
    },
    TIMEOUT,
  )

  test(
    "viewer is read-only and its writes are not persisted",
    async () => {
      const viewerClient = connect(viewerCookie)
      expect(await viewerClient.outcome).toEqual({ ok: true, scope: "readonly" })
      const editorClient = connect(editorCookie)
      expect((await editorClient.outcome).ok).toBe(true)

      await waitFor(() => text(viewerClient.doc).includes("from A"), "viewer to sync")
      append(viewerClient.doc, "viewer-write")
      append(editorClient.doc, "editor-marker")
      await waitFor(async () => (await stored()).includes("editor-marker"), "editor write stored")

      expect(await stored()).not.toContain("viewer-write")
      expect(text(editorClient.doc)).not.toContain("viewer-write")
    },
    TIMEOUT,
  )

  test(
    "stranger without access is rejected",
    async () => {
      const denied = connect(strangerCookie)
      expect(await denied.outcome).toEqual({ ok: false, reason: "forbidden" })
      const anonymous = connect(null)
      expect(await anonymous.outcome).toEqual({ ok: false, reason: "unauthenticated" })
    },
    TIMEOUT,
  )

  test(
    "store persists the content of the connected documents",
    async () => {
      const client = connect(editorCookie)
      expect((await client.outcome).ok).toBe(true)
      append(client.doc, "persisted paragraph")
      await waitFor(async () => (await stored()).includes("persisted paragraph"), "content stored")
      expect(await stored()).toContain("from A")
    },
    TIMEOUT,
  )

  test(
    "a restored version replaces the text of live sessions",
    async () => {
      const first = connect(editorCookie)
      const second = connect(viewerCookie)
      expect((await first.outcome).ok).toBe(true)
      expect((await second.outcome).ok).toBe(true)

      append(first.doc, "marker-before")
      await waitFor(async () => (await stored()).includes("marker-before"), "marker-before stored")
      const version = await runAs(
        db,
        owner.actor,
      )(createDocVersion.execute({ docId, label: "before marker" }))

      append(first.doc, "marker-after")
      await waitFor(
        () => [first.doc, second.doc].every((document) => text(document).includes("marker-after")),
        "marker-after to reach both sessions",
      )
      await waitFor(async () => (await stored()).includes("marker-after"), "marker-after stored")

      const response = await fetch(`${origin}/api/docs/${docId}/versions/${version.id}/restore`, {
        method: "POST",
        headers: { cookie: ownerCookie, origin },
      })
      expect(response.status).toBe(200)

      await waitFor(
        () =>
          [first.doc, second.doc].every((document) => {
            const content = text(document)
            return content.includes("marker-before") && !content.includes("marker-after")
          }),
        "restore to reach both sessions",
      )
      await waitFor(async () => {
        const persisted = await stored()
        return persisted.includes("marker-before") && !persisted.includes("marker-after")
      }, "restored content stored")
    },
    TIMEOUT,
  )
})
