// Capacity scenario: API_VUS VUs (default 200) for DURATION (default 5m) mixing board view, doc
// open, channel history, search, task move, and message post, plus 25 `/rpc` connections (with
// presence updates) and 25 `/collab` document sessions held open for the same duration.
//
//   docker run --rm --network host -v "$PWD/load:/scripts" grafana/k6 run /scripts/mixed.js
//
// Each API VU takes a think time of 5-15 s between actions (THINK_MIN/THINK_MAX). This is the
// scenario definition the user chose; 0.5-1.5 s is kept only as a stress run. Requests are tagged
// `kind:api`.
// The API VUs ramp from 0 to API_VUS over RAMP (default 60s), then hold for DURATION. Starting all
// VUs at t=0 puts about 200 first requests in the same second, which queues for about 3 s on the
// app and dominates p99. The summary covers the whole run, ramp included.

import http from "k6/http"
import { sleep } from "k6"
import { Rate, Trend } from "k6/metrics"
import { BASE, PEOPLE, jsonHeaders, signInAll } from "./lib.js"
import { discover } from "./fixtures.js"
import { rpcHold, collabHold } from "./realtime.js"

export { rpcHold, collabHold }

const API_VUS = Number(__ENV.API_VUS || 200)
const DURATION = __ENV.DURATION || "5m"
const RAMP = __ENV.RAMP || "60s"
const SOCKET_HOLD = `${__ENV.HOLD_SECONDS || 300}s`
const THINK_MIN = Number(__ENV.THINK_MIN || 5)
const THINK_MAX = Number(__ENV.THINK_MAX || 15)

export const options = {
  setupTimeout: "20m",
  summaryTrendStats: ["avg", "min", "med", "max", "count", "p(50)", "p(95)", "p(99)"],
  scenarios: {
    api: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: API_VUS },
        { duration: DURATION, target: API_VUS },
      ],
      exec: "apiMix",
      gracefulStop: "30s",
    },
    // One iteration per VU: each iteration holds its socket until HOLD_SECONDS, then ends.
    rpc: {
      executor: "per-vu-iterations",
      vus: 25,
      iterations: 1,
      exec: "rpcHold",
      maxDuration: `${Number(SOCKET_HOLD.replace("s", "")) + 60}s`,
    },
    collab: {
      executor: "per-vu-iterations",
      vus: 25,
      iterations: 1,
      exec: "collabHold",
      maxDuration: `${Number(SOCKET_HOLD.replace("s", "")) + 60}s`,
    },
  },
  thresholds: {
    api_latency: ["p(95)<150"],
    api_failures: ["rate<0.01"],
  },
}

const ENDPOINTS = [
  "board_view",
  "doc_open",
  "channel_history",
  "search",
  "task_move",
  "message_post",
]
const latency = Object.fromEntries(ENDPOINTS.map((name) => [name, new Trend(`lat_${name}`, true)]))
const apiLatency = new Trend("api_latency", true)
const apiFailures = new Rate("api_failures")
const SOCKET_COUNTERS = [
  "rpc_connected",
  "rpc_hello",
  "rpc_frames",
  "presence_update_sent",
  "presence_update_accepted",
  "presence_update_rejected",
  "collab_authenticated",
  "collab_denied",
  "socket_errors",
]

function record(endpoint, res) {
  const ok = res.status >= 200 && res.status < 300
  apiLatency.add(res.timings.duration)
  latency[endpoint].add(res.timings.duration)
  apiFailures.add(!ok)
  return ok
}

function call(endpoint, method, path, cookie, body) {
  const res = http.request(
    method,
    `${BASE}${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: jsonHeaders(cookie),
      tags: { kind: "api", endpoint },
    },
  )
  record(endpoint, res)
  return res
}

const pick = (items) => items[Math.floor(Math.random() * items.length)]

const SENTENCES = [
  "Shipping the invoice fix after review.",
  "Latency on the staging board looks better today.",
  "Can someone check the release checklist before Friday?",
  "Filed the audit follow-up under ENG.",
]

export function setup() {
  const sessions = signInAll(PEOPLE)
  const fixtures = discover(sessions[0])
  return { sessions, fixtures }
}

export function apiMix(data) {
  const cookie = data.sessions[(__VU - 1) % data.sessions.length]
  const f = data.fixtures
  const roll = Math.random() * 100

  if (roll < 25) {
    call("board_view", "GET", `/api/boards/${f.boardId}/view`, cookie)
  } else if (roll < 45) {
    call("doc_open", "GET", `/api/docs/${pick(f.docs)}`, cookie)
  } else if (roll < 65) {
    call(
      "channel_history",
      "GET",
      `/api/chat/channels/${pick(f.channels)}/messages?limit=50`,
      cookie,
    )
  } else if (roll < 80) {
    call("search", "GET", `/api/search?q=${pick(f.searches)}`, cookie)
  } else if (roll < 90) {
    call("task_move", "POST", `/api/tasks/${pick(f.tasks)}/move`, cookie, {
      columnId: pick(f.columnIds),
      afterTaskId: null,
    })
  } else {
    call("message_post", "POST", `/api/chat/channels/${pick(f.channels)}/messages`, cookie, {
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: pick(SENTENCES) }] }],
      },
    })
  }

  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN))
}

const fmt = (ms) => (ms === undefined ? "n/a" : `${ms.toFixed(1)} ms`)

export function handleSummary(data) {
  const rows = ENDPOINTS.map((name) => {
    const m = data.metrics[`lat_${name}`]
    if (!m) return `${name}: no samples`
    const v = m.values
    return `${name.padEnd(16)} count=${v.count} p50=${fmt(v["p(50)"])} p95=${fmt(v["p(95)"])} p99=${fmt(v["p(99)"])}`
  })
  const all = data.metrics.api_latency.values
  const failures = data.metrics.api_failures.values.rate
  const counters = SOCKET_COUNTERS.map((name) => {
    const m = data.metrics[name]
    return `${name}=${m ? m.values.count : 0}`
  })
  const text = [
    "per endpoint (api requests only):",
    ...rows,
    `all api: count=${all.count} p50=${fmt(all["p(50)"])} p95=${fmt(all["p(95)"])} p99=${fmt(all["p(99)"])}`,
    `api error rate: ${(failures * 100).toFixed(3)}%`,
    `sockets: ${counters.join(" ")}`,
    "",
  ].join("\n")
  return { stdout: text }
}
