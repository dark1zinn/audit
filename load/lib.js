// Shared helpers for the audit k6 scripts: paced sign-in, JSON calls, and the Hocuspocus frame
// format for `/collab`. The Effect RPC `/rpc` frames live in realtime.js.

import http from "k6/http"
import { sleep } from "k6"

export const BASE = __ENV.AUDIT_URL || "http://localhost:3000"
export const WS_BASE = BASE.replace(/^http/, "ws")
export const PASSWORD = __ENV.DEMO_PASSWORD || "correct horse battery staple"
export const SESSION_COOKIE = "better-auth.session_token"

// The 25 people `audit seed --demo` invites (apps/server/src/seed-demo.ts). Emails are the
// lowercased names with spaces replaced by dots. USERS=<n> limits the list for smoke runs only.
const NAMES = [
  "Ana Souza",
  "Bruno Lima",
  "Carla Mendes",
  "Diego Alves",
  "Elisa Rocha",
  "Felipe Costa",
  "Gabriela Nunes",
  "Heitor Dias",
  "Isabela Ramos",
  "Joao Pereira",
  "Karen Duarte",
  "Lucas Teixeira",
  "Marina Cardoso",
  "Nicolas Faria",
  "Olivia Pinto",
  "Paulo Ribeiro",
  "Quirino Moura",
  "Renata Lopes",
  "Samuel Gomes",
  "Tatiana Vieira",
  "Ugo Barros",
  "Vanessa Campos",
  "Wagner Correia",
  "Xenia Monteiro",
  "Yuri Fonseca",
]

export const PEOPLE = NAMES.map(
  (name) => `${name.toLowerCase().replaceAll(" ", ".")}@example.test`,
).slice(0, Number(__ENV.USERS || 25))

export function jsonHeaders(cookie) {
  const headers = { "Content-Type": "application/json", Origin: BASE }
  if (cookie) headers.Cookie = cookie
  return headers
}

// Signs one user in. `/api/auth/sign-in/email` allows 5 requests per 60 s per IP, so callers
// pace batches (see signInAll); a 429 here waits out the window and retries.
export function signIn(email) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = http.post(
      `${BASE}/api/auth/sign-in/email`,
      JSON.stringify({ email, password: PASSWORD }),
      { headers: jsonHeaders(), tags: { endpoint: "sign_in", kind: "setup" } },
    )
    if (res.status === 200) {
      const jar = res.cookies[SESSION_COOKIE]
      if (!jar || jar.length === 0) throw new Error(`no session cookie for ${email}`)
      return `${SESSION_COOKIE}=${jar[0].value}`
    }
    if (res.status !== 429) throw new Error(`sign-in ${email} failed: ${res.status} ${res.body}`)
    sleep(61)
  }
  throw new Error(`sign-in ${email} still rate limited`)
}

// Signs everyone in, five per window, so the setup never trips the sign-in limiter.
export function signInAll(emails) {
  const sessions = []
  emails.forEach((email, i) => {
    if (i > 0 && i % 5 === 0) sleep(61)
    sessions.push(signIn(email))
  })
  return sessions
}

export function getJson(path, cookie) {
  const res = http.get(`${BASE}${path}`, { headers: jsonHeaders(cookie), tags: { kind: "setup" } })
  if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status} ${res.body}`)
  return res.json()
}

// --- lib0 varint / varstring (ASCII only: document names here are ASCII) ----------------------

function writeVarUint(out, value) {
  let n = value
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f))
    n = Math.floor(n / 128)
  }
  out.push(n)
}

function writeVarString(out, text) {
  writeVarUint(out, text.length)
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i))
}

function readVarUint(buf, state) {
  let value = 0
  let mult = 1
  for (;;) {
    const byte = buf[state.pos++]
    value += (byte & 0x7f) * mult
    mult *= 128
    if (byte < 0x80) return value
  }
}

function readVarString(buf, state) {
  const length = readVarUint(buf, state)
  let text = ""
  for (let i = 0; i < length; i++) text += String.fromCharCode(buf[state.pos++])
  return text
}

const MESSAGE_SYNC = 0
const MESSAGE_AUTH = 2
const AUTH_TOKEN = 0
const AUTH_PERMISSION_DENIED = 1
const AUTH_AUTHENTICATED = 2
const SYNC_STEP1 = 0

// Hocuspocus frame: varString(documentName), varUint(type), payload parts.
export function collabFrame(documentName, parts) {
  const out = []
  writeVarString(out, documentName)
  for (const part of parts) out.push(...part)
  return new Uint8Array(out).buffer
}

// SyncStep1 with an empty Y.Doc state vector (one zero byte, length-prefixed).
export function collabSyncStep1() {
  const out = [MESSAGE_SYNC]
  writeVarUint(out, SYNC_STEP1)
  writeVarUint(out, 1)
  out.push(0)
  return out
}

export function collabAuthToken(token) {
  const out = [MESSAGE_AUTH]
  writeVarUint(out, AUTH_TOKEN)
  writeVarString(out, token)
  return out
}

// Reads the header of an incoming frame and reports the auth step it carries, if any.
export function decodeCollab(data) {
  const buf = new Uint8Array(data)
  const state = { pos: 0 }
  const documentName = readVarString(buf, state)
  const type = readVarUint(buf, state)
  let auth = null
  if (type === MESSAGE_AUTH) {
    const sub = readVarUint(buf, state)
    if (sub === AUTH_TOKEN) auth = "token"
    else if (sub === AUTH_PERMISSION_DENIED) auth = "denied"
    else if (sub === AUTH_AUTHENTICATED) auth = "authenticated"
  }
  return { documentName, type, auth }
}
