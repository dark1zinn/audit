# Load tests

k6 scripts for the capacity gates in `docs/operations/capacity.md`. They run from the
`grafana/k6` image against a stack from `deploy/compose.yml`.

## Files

- `lib.js`: base URLs, sign-in (paced to the 5-per-minute limiter), JSON and collab frame helpers.
- `fixtures.js`: discovers board, project, task, doc, channel, and search fixtures from the seeded data.
- `mixed.js`: the main scenario. 200 VUs for 5 minutes doing board view, doc open, channel history,
  search, task move, and message post, plus 25 held `/rpc` and 25 held `/collab` sockets.
- `realtime.js`: the held socket behaviour used by `mixed.js` and `idle.js`.
- `idle.js`: 25 people's realtime sockets held open with no API traffic, for the idle memory gate.

## Running

Start the stack from the image built at HEAD, seed it, and limit the app container:

```sh
docker build -f deploy/Dockerfile -t audit:local .
docker compose -f deploy/compose.yml up -d --no-build
docker update --cpus 2 --memory 4g --memory-swap 4g audit-app-1
docker exec audit-app-1 /app/audit seed --demo
```

Run the mixed scenario (about 5 minutes of sign-in setup, then 5 minutes of load):

```sh
docker run --rm --network host \
  -e AUDIT_URL=http://localhost:3000 \
  -v "$PWD/load:/scripts:ro" -v /tmp/perf-results:/results \
  grafana/k6 run --summary-export /results/mixed.json /scripts/mixed.js
```

Run the idle memory gate, then read the container memory after the hold:

```sh
docker run --rm --network host \
  -e AUDIT_URL=http://localhost:3000 -e HOLD_SECONDS=330 \
  -v "$PWD/load:/scripts:ro" grafana/k6 run /scripts/idle.js
docker stats --no-stream audit-app-1 audit-postgres-1
```

`idle.js` prints `IDLE-START` when all sockets are open. Read `docker stats` after the hold.

## Knobs

| Variable               | Default                        | Purpose                                                                 |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `AUDIT_URL`            | `http://localhost:3000`        | Base URL. Also sent as the `Origin` header on every request.            |
| `API_VUS`              | `200`                          | VUs for the API mix.                                                    |
| `DURATION`             | `5m`                           | API mix duration.                                                       |
| `HOLD_SECONDS`         | `300`                          | How long each realtime socket stays open.                               |
| `THINK_MIN`            | `5`                            | Minimum think time per API iteration, in seconds (scenario definition). |
| `THINK_MAX`            | `15`                           | Maximum think time per API iteration, in seconds (scenario definition). |
| `PRESENCE_INTERVAL_MS` | `2000`                         | Interval between `presence.update` calls per `/rpc` socket.             |
| `USERS`                | `25`                           | Limit the number of seeded people. Smoke runs only.                     |
| `DEMO_PASSWORD`        | `correct horse battery staple` | Password for the seeded people.                                         |

`USERS` below 25 makes several sockets share one user. The presence throttle is per user
(1 update per second), so most updates from shared users are rejected. Use the full 25 for
measurements.

## Pacing

- Sign-in is limited to 5 requests per 60 seconds per IP. `lib.js` signs in 5 people, waits 61 seconds,
  and retries on 429. Setup takes about 5 minutes with 25 people.
- The API mix uses 5 to 15 seconds of think time per iteration (`THINK_MIN`, `THINK_MAX`). The user chose this as the scenario definition. For a stress run, set `THINK_MIN=0.5 THINK_MAX=1.5`.
- `/rpc` sends `presence.update` every `PRESENCE_INTERVAL_MS` after a 1 second delay. The first
  update waits so the join is registered.

## Protocol notes

- `/rpc` is Effect RPC over JSON text frames. Requests are `{"_tag":"Request",...}`.
- `/collab` is Hocuspocus over binary frames. k6 needs `sendBinary` for sending and the
  `binaryMessage` event for receiving. The server requires the first frame for each document to be
  an Auth token message. The session cookie on the upgrade request is what it checks.

## Output

The summary prints per-endpoint p50/p95/p99 for the API actions, the overall API p95 and error rate,
and socket counters. `--summary-export` writes the full JSON.
