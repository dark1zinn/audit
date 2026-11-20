// Long-lived realtime sockets: one `/rpc` connection per VU (a workspace subscription plus
// presence on a document entity, with focus and typing updates) and one `/collab` document
// session per VU. Each VU holds its socket for HOLD_SECONDS, so the VU count is the open-socket count.

import ws from "k6/ws"
import { Counter } from "k6/metrics"
import {
  WS_BASE,
  jsonHeaders,
  collabFrame,
  collabSyncStep1,
  collabAuthToken,
  decodeCollab,
} from "./lib.js"

const HOLD_MS = Number(__ENV.HOLD_SECONDS || 300) * 1000
const PRESENCE_INTERVAL_MS = Number(__ENV.PRESENCE_INTERVAL_MS || 2000)

export const rpcConnected = new Counter("rpc_connected")
export const rpcHello = new Counter("rpc_hello")
export const rpcFrames = new Counter("rpc_frames")
export const presenceSent = new Counter("presence_update_sent")
export const presenceAccepted = new Counter("presence_update_accepted")
export const presenceRejected = new Counter("presence_update_rejected")
export const collabAuthenticated = new Counter("collab_authenticated")
export const collabDenied = new Counter("collab_denied")
export const socketErrors = new Counter("socket_errors")

function rpcRequest(id, tag, payload) {
  return JSON.stringify({ _tag: "Request", id: String(id), tag, payload, headers: [] })
}

// Effect RPC over JSON: one `Request` frame per call; streams come back as `Chunk` frames.
// Subscribes to the workspace scopes a signed-in person sees, joins presence on one document
// entity, and then refreshes focus and typing on that entity every PRESENCE_INTERVAL_MS.
export function rpcHold(data) {
  const cookie = data.sessions[(__VU - 1) % data.sessions.length]
  const channel = data.fixtures.channels[0]
  const entity = data.fixtures.docs[(__VU - 1) % data.fixtures.docs.length]
  const scope = `entity:${entity}`
  const scopes = ["workspace", "inbox", "project:ENG", `channel:${channel}`]
  ws.connect(`${WS_BASE}/rpc`, { headers: jsonHeaders(cookie) }, (socket) => {
    let nextId = 1
    let tick = 0
    socket.on("open", () => {
      rpcConnected.add(1)
      socket.send(rpcRequest(nextId++, "realtime.subscribe", { scopes }))
      socket.send(rpcRequest(nextId++, "presence.join", { scope }))
      // First update waits a second so the join is registered before focus is sent.
      socket.setTimeout(() => {
        socket.setInterval(() => {
          tick++
          presenceSent.add(1)
          socket.send(
            rpcRequest(nextId++, "presence.update", {
              scope,
              focusEntityId: entity,
              typing: tick % 2 === 0,
            }),
          )
        }, PRESENCE_INTERVAL_MS)
      }, 1000)
      socket.setTimeout(() => socket.close(), HOLD_MS)
    })
    socket.on("message", (message) => {
      if (message.includes('"Hello"')) rpcHello.add(1)
      if (message.includes('"accepted":true')) presenceAccepted.add(1)
      if (message.includes('"accepted":false')) presenceRejected.add(1)
      rpcFrames.add(1)
    })
    socket.on("error", () => socketErrors.add(1))
  })
}

// Opens one document over Hocuspocus. The server requires the first frame for a document to be
// an Auth token message (the session cookie on the upgrade request is what it checks), and it
// queues everything else until it answers with Authenticated. So the VU sends Auth, then SyncStep1.
export function collabHold(data) {
  const cookie = data.sessions[(__VU - 1) % data.sessions.length]
  const docs = data.fixtures.docs
  const documentName = `doc:${docs[(__VU - 1) % docs.length]}`
  ws.connect(`${WS_BASE}/collab`, { headers: jsonHeaders(cookie) }, (socket) => {
    socket.on("open", () => {
      socket.sendBinary(collabFrame(documentName, [collabAuthToken("")]))
      socket.sendBinary(collabFrame(documentName, [collabSyncStep1()]))
      socket.setTimeout(() => socket.close(), HOLD_MS)
    })
    socket.on("binaryMessage", (message) => {
      const frame = decodeCollab(message)
      if (frame.auth === "authenticated") collabAuthenticated.add(1)
      else if (frame.auth === "denied") collabDenied.add(1)
    })
    socket.on("error", () => socketErrors.add(1))
  })
}
