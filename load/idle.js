// Idle memory scenario: 25 seeded people each hold one `/rpc` subscription and one `/collab`
// document open for HOLD_SECONDS (set by memory.sh) with no other traffic. memory.sh samples
// `docker stats` five minutes after the sockets are up.
//
//   bash load/memory.sh

import { PEOPLE, signInAll } from "./lib.js"
import { discover } from "./fixtures.js"
import { rpcHold, collabHold } from "./realtime.js"

export { rpcHold, collabHold }

export const options = {
  setupTimeout: "20m",
  scenarios: {
    rpc: {
      executor: "per-vu-iterations",
      vus: 25,
      iterations: 1,
      exec: "rpcHold",
      maxDuration: "20m",
    },
    collab: {
      executor: "per-vu-iterations",
      vus: 25,
      iterations: 1,
      exec: "collabHold",
      maxDuration: "20m",
    },
  },
}

export function setup() {
  const sessions = signInAll(PEOPLE)
  const fixtures = discover(sessions[0])
  // memory.sh waits for this line, then samples after the hold.
  console.log("IDLE-START")
  return { sessions, fixtures }
}
