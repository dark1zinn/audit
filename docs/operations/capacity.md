# Capacity

This page records the load test results for one audit instance and the gates they are checked
against. The scripts live in `load/`; see `load/README.md` for how to run them.

## Gates

| Gate                                                 | Target                 |
| ---------------------------------------------------- | ---------------------- |
| API p95 latency, 200 concurrent virtual users        | under 150 ms           |
| API error rate under the same load                   | under 1%               |
| Idle RSS with 25 realtime sockets, app plus Postgres | under 1 GB after 5 min |

## Environment

- Host: 12 vCPU Linux x64. Container limits for the app: `--cpus 2 --memory 4g`. Postgres: no
  limit.
- Build: `deploy/Dockerfile` image `audit:local`, built from `git archive 4d5cc51` (HEAD) for the final runs
- Data: seeded demo workspace (`load/fixtures.js` reads it): 5 projects, 5 boards, about 2,000
  tasks, 200 docs, 23 channels, about 20,600 messages, 25 people, 26 user profiles, 23,120 live
  entities.
- Load: 25 users for the mixed scenario, 200 API virtual users, 5 minutes, with 5 to 15 s think
  time between actions (the default scenario from the post-fix runs on). The 0.5 to 1.5 s runs
  below are a stress run.
  Mix: board view 25%, doc open 20%, channel history 20%, search 15%, task move 10%, message post 10%.

## Baseline (before the visibility fix)

Mixed scenario, 5 minutes, 200 API VUs. Latency in milliseconds.

| Endpoint        | Requests |   p50 |   p95 |   p99 |
| --------------- | -------: | ----: | ----: | ----: |
| board view      |    3,917 | 4,207 | 5,767 | 7,243 |
| doc open        |    3,081 | 2,344 | 3,493 |   n/a |
| channel history |    3,135 | 3,151 | 4,566 |   n/a |
| search          |    2,398 | 1,485 | 2,327 |   n/a |
| task move       |    1,515 | 2,099 | 3,208 |   n/a |
| message post    |    1,553 | 2,054 | 3,205 |   n/a |
| all API         |   15,599 | 2,645 | 5,235 | 5,950 |

Error rate 0.000%, about 52 requests per second overall. The API p95 gate fails.

Sequential, unloaded, one user:

- Board view: p50 about 115 ms, max about 180 ms, 263 KB response, 400 cards in one response.
- Message post: 25 to 41 ms wall time, every statement under 7 ms.

Statement profile of one board view: about 11 statements per request. The task-row query accounts
for about 74 ms of Postgres time per request, about 93% of SQL time. Its cause is the per-row
recursive walk in the visibility check (`packages/core/src/access.ts`, `visibleTo`), which runs once
per task row.

Board burst at concurrency 8 (200 requests): 29 requests per second, p50 268 ms, p95 333 ms.
During the burst Postgres used about 260% CPU and the app container about 105%.

Idle memory gate (25 realtime sockets, 330 s hold): app 198.8 MiB, Postgres 207.1 MiB, total about
406 MiB. Pass.

Connection pools: the app's database pool is 10 connections. Auth uses 4 and the job queue uses 6.
Postgres `max_connections` is 100, with 17 in use during the run.

## After the visibility fix (`entities.access_path`)

Visibility and role checks now read `entities.access_path`, the entity's chain up to its nearest
container or restricted boundary, maintained by triggers and backfilled by migration
`20261120032026_access_path`. Each check is a primary key lookup plus an array overlap. Rules are
unchanged, and an oracle test compares the new checks with the previous recursive query on random
edits.

Mixed scenario, 5 minutes, 200 API VUs. Latency in milliseconds, before and after.

| Endpoint        | p50 before | p50 after | p95 before | p95 after | Requests before | Requests after |
| --------------- | ---------: | --------: | ---------: | --------: | --------------: | -------------: |
| board view      |      4,207 |     2,126 |      5,767 |     2,905 |           3,917 |          5,929 |
| doc open        |      2,344 |     1,251 |      3,493 |     1,782 |           3,081 |          4,745 |
| channel history |      3,151 |     1,668 |      4,566 |     2,375 |           3,135 |          4,860 |
| search          |      1,485 |       888 |      2,327 |     1,236 |           2,398 |          3,455 |
| task move       |      2,099 |     1,167 |      3,208 |     1,674 |           1,515 |          2,338 |
| message post    |      2,054 |     1,162 |      3,205 |     1,683 |           1,553 |          2,454 |
| all API         |      2,645 |     1,432 |      5,235 |     2,446 |          15,599 |         23,781 |

After p99: board view 3,536, doc open 2,296, channel history 2,774, search 1,660, task move 2,134,
message post 2,146, all API 3,054. Error rate 0.000%. Throughput rose from about 52 to about 79
requests per second. The API p95 gate (under 150 ms) still fails: p95 is 2,446 ms overall.

Sequential, unloaded, one user: board view p50 about 35 ms (max about 57 ms), down from about
115 ms.

Board burst at concurrency 8 (200 requests): 44 requests per second, p50 177 ms, p95 217 ms
(before: 29 requests per second, p50 268 ms, p95 333 ms).

Idle memory gate (25 realtime sockets, 330 s hold): app 264.1 MiB, Postgres 272.9 MiB, total about
537 MiB. Pass.

The API p95 gate is not met. The latency left under 200 closed-loop VUs is likely queueing on the
2-CPU app container [INFERENCE]. The statement-level profile was not repeated after the fix, so the
cost split is not measured here.

## Post-fix profile (idle server, one request per endpoint)

Measured after the fix, with the server otherwise idle. Each request was timed on the client, and
its SQL was taken from the Postgres statement log (`log_min_duration_statement = 0` for the
measurement only, then reset). SQL time is the summed execute time of the statements logged in
the request's window. App-side time is the client time minus that SQL time. It includes round
trips between statements, route handling, and response encoding. It is not split further.

| Endpoint        | Client ms |   Bytes | Statements | SQL ms | App-side ms | Largest statement         |
| --------------- | --------: | ------: | ---------: | -----: | ----------: | ------------------------- |
| board view      |      36.3 | 263,632 |         12 |    5.4 |        30.9 | task rows, 4.3 ms         |
| doc open        |       7.4 |     407 |          8 |    0.7 |         6.7 | session lookup, 0.1 ms    |
| channel history |      14.0 |  27,675 |         10 |    1.5 |        12.5 | messages page, 1.0 ms     |
| search          |     204.7 |   9,556 |         31 |  207.3 |        -2.6 | candidate query, 173.7 ms |

The search window includes background `pgboss` polling statements, so its SQL total is slightly
high, and its app-side figure is not meaningful. The candidate query alone is 173.7 ms.

Top three remaining costs:

1. Search candidate query: 173.7 ms of a 204.7 ms request (sequential). It ranks every text match
   before the visibility check runs [INFERENCE from the query shape, not from a plan].
2. Board view app-side time: 30.9 ms of 36.3 ms. This is outside SQL. It is most likely JSON
   encoding of the 263 KB payload and per-statement round trips [INFERENCE; not measured].
3. Search headline: `ts_headline` on the returned rows, 10.0 ms.

## Burst at concurrency 8 (board view, 20 s, with docker stats)

| Metric                | Value                                        |
| --------------------- | -------------------------------------------- |
| Requests              | 958                                          |
| Throughput            | 47.6 requests per second                     |
| p50 / p95 / p99       | 163.9 / 203.2 / 255.1 ms                     |
| App CPU (t+5 s)       | 130.6% of one core (container limit 2 cores) |
| App CPU (t+12 s)      | 119.7% of one core                           |
| Postgres CPU (t+5 s)  | 74.2% of one core                            |
| Postgres CPU (t+12 s) | 73.2% of one core                            |

`docker stats` reports CPU per core, so the app is at about 60 to 65% of its 2-core limit and
Postgres is at about 73% of one core, during this burst.

## 5 to 15 s think time, final run (HEAD 4d5cc51)

Fresh stack: image `audit:local` built from `git archive 4d5cc51` (exit 0), new volumes
(`docker compose down -v` first), `migrate` exit 0, `seed --demo` exit 0 (21,476 entities), app
limited to `--cpus 2 --memory 4g --memory-swap 4g`. Scenario: 200 API VUs for 5 minutes with 5 to
15 s think time, plus 25 `/rpc` and 25 `/collab` sockets. Two gate runs (A, B) and one idle memory
gate.

| Gate                                      | Target       | Result                                         | Verdict |
| ----------------------------------------- | ------------ | ---------------------------------------------- | ------- |
| API p95 latency, 200 VUs, 5 to 15 s think | under 150 ms | 98.6 ms (A), 91.4 ms (B)                       | pass    |
| API error rate                            | under 1%     | 0.000% (A), 0.017% (B)                         | pass    |
| Idle RSS, 25 sockets, 330 s hold          | under 1 GB   | app 169.4 MiB + Postgres 197.6 MiB (about 367) | pass    |

Per endpoint, latency in milliseconds (k6 exit 0 for A and B):

| Endpoint        | A requests | A p50 | A p95 |   A p99 | B requests | B p50 | B p95 |   B p99 |
| --------------- | ---------: | ----: | ----: | ------: | ---------: | ----: | ----: | ------: |
| board view      |      1,517 |  44.4 | 107.1 | 3,240.1 |      1,515 |  45.2 |  99.3 | 2,794.1 |
| doc open        |      1,244 |   9.7 |  54.2 | 2,145.5 |      1,230 |   9.0 |  49.7 | 1,812.9 |
| channel history |      1,187 |  27.4 |  68.8 | 2,459.2 |      1,218 |  19.6 |  55.3 | 2,071.4 |
| search          |        948 |  39.2 | 103.9 | 1,017.9 |        917 |  39.3 | 101.4 |   907.4 |
| task move       |        592 |  27.1 | 135.0 | 1,810.6 |        600 |  27.6 |  90.1 | 1,372.2 |
| message post    |        578 |  25.4 | 102.6 | 1,749.2 |        578 |  24.1 | 138.4 | 1,459.9 |
| all API         |      6,066 |  32.1 |  98.6 | 2,447.0 |      6,058 |  29.4 |  91.4 | 2,056.3 |

Errors: run A 0 failed requests. Run B 1 failed request: a `POST` to a channel message at
13:24:44 UTC with status 0, k6 error `EOF` after 1.3 ms on a reused connection. That is the
keep-alive race: the server closed the idle connection (Bun's default idle timeout is 10 s, inside
the 5 to 15 s think time) just as the client reused it. The server now keeps idle connections for
120 s (`idleTimeout` in `apps/server/src/server.ts`), longer than common reverse-proxy upstream
idle timeouts, so the proxy, not the app, closes first. A raw keep-alive connection idle for 12 s
is closed by the old default and stays usable with the new setting.

Stress run, 0.5 to 1.5 s think time (5 minutes, 200 VUs). The server is saturated at about 78
requests per second, so latency is queueing. Error rate 0.000%. The k6 run exited 99 because the p95
threshold was crossed.

| Endpoint        | Requests |     p50 |     p95 |     p99 |
| --------------- | -------: | ------: | ------: | ------: |
| board view      |    5,879 | 2,347.0 | 2,900.9 | 3,162.5 |
| doc open        |    4,739 | 1,355.0 | 1,775.7 | 1,953.3 |
| channel history |    4,692 | 1,810.7 | 2,295.2 | 2,472.1 |
| search          |    3,471 |   738.1 | 1,041.9 | 1,228.3 |
| task move       |    2,397 | 1,230.0 | 1,625.5 | 1,811.9 |
| message post    |    2,312 | 1,222.7 | 1,585.3 | 2,167.2 |
| all API         |   23,490 | 1,478.3 | 2,619.5 | 2,926.9 |

### p99 stalls: start burst from the k6 scenario

The 3 to 4 s p99 window is the start of the run, not a steady-state stall. In all three gate runs
it is the first 2 to 3 seconds of API traffic, measured from the first API request:

| Run                    | t+0 s (n, mean ms) | t+1 s (n, mean ms) | t+2 s (n, mean ms) | t+5 s onward (mean ms) |
| ---------------------- | ------------------ | ------------------ | ------------------ | ---------------------- |
| A (200 VUs at t=0)     | 58, 1242           | 97, 2176           | 45, 3177           | about 25 to 30         |
| B (200 VUs at t=0)     | 89, 1234           | 86, 2086           | 25, 2798           | about 25 to 37         |
| run 6 (200 VUs at t=0) | 68, 1172           | 92, 1991           | 40, 2769           | about 20 to 36         |

Exactly 200 requests land in the first seconds, one per VU, because every VU starts at t=0 and
fires its first request at once. The backlog drains at about 2 s per 200 requests on the 2 CPU app,
then requests return in about 25 ms. The server does not stall for 3 s at any other point.

Fix (script only, no server change): API VUs now ramp from 0 to 200 over `RAMP` (default 60 s) and
then hold for `DURATION`. See `load/README.md`.

Ramped gate run (HEAD 4d5cc51, fresh stack, seed `--demo` exit 0, k6 exit 0):

| Endpoint        | Requests |  p50 |  p95 |  p99 |   max |
| --------------- | -------: | ---: | ---: | ---: | ----: |
| board view      |    1,683 | 37.0 | 63.5 | 88.1 | 149.0 |
| doc open        |    1,352 |  7.2 | 21.0 | 41.1 | 111.5 |
| channel history |    1,299 | 22.8 | 42.6 | 62.0 | 141.3 |
| search          |    1,012 | 34.0 | 53.7 | 68.4 | 138.6 |
| task move       |      647 | 21.3 | 46.3 | 64.9 | 147.1 |
| message post    |      668 | 18.5 | 41.5 | 64.7 | 155.0 |
| all API         |    6,661 | 24.5 | 52.2 | 74.0 | 155.0 |

No API request took over 1 s. The earlier 175 to 181 slow requests per run were all in the first
seconds. Write endpoints show no p95 spike in this run (task move p95 46.3 ms, message post 41.5 ms).
Failed requests: 0. Server logs in the window: no errors.

Note: the k6 summary JSON reports `p(95)<150` as `false` even with p95 52.2 ms; the k6 exit code (0)
is used as the threshold result for this run.

Host disk: the root filesystem was 99% full (2.5 GB free) during the earlier runs on this host.

## Search candidate query (`windowRows`)

Before: `audit_search_config()` is a stable SQL function that reads the workspace row. Postgres
inlined it into the query, so it was evaluated once per matching row, and `ts_rank_cd` ran on
every match before `LIMIT`. `EXPLAIN (ANALYZE, BUFFERS)` for `release` (6,710 matches): 193.9 ms
execution, 28,111 buffers.

After: the query text is built once in a `materialized` CTE (`qq`) and cross-joined. The same
`EXPLAIN` gives 63.8 ms and 1,360 buffers. The remaining cost is the exact ranking over every
match, which is inherent to the current ranking.

`bench-search.ts` before and after (ms):

| Path    | Before p50 | Before p95 | After p50 | After p95 |
| ------- | ---------: | ---------: | --------: | --------: |
| search  |       23.7 |      182.3 |      20.7 |      37.6 |
| quick   |       78.9 |      102.6 |      65.1 |      99.7 |
| overall |          - |      157.9 |      28.5 |      89.8 |

The quick path (ILIKE over titles, with per-row visibility) is not optimized yet. Its p50 is about
65 ms.

## Confirmation run (a96b085)

Fresh image from `git archive a96b085` (build exit 0). Fresh stack, app `--cpus 2 --memory 4g`,
`migrate` exit 0, `seed --demo` exit 0. Scenario: `RAMP=60s`, 200 API VUs, 5 to 15 s think, 5 min
hold, plus 25 `/rpc` and 25 `/collab` sockets. k6 exit 0.

- Failed requests: 0 (`http_req_failed` 0 of 6,729). The earlier single failure (gate B) did not
  recur.
- API p50 28.8, p95 133.0, p99 1,377.7 ms (6,700 requests, max 3,085 ms).

| Endpoint        | Requests |  p50 |   p95 |     p99 |
| --------------- | -------: | ---: | ----: | ------: |
| board view      |    1,619 | 39.0 |  76.9 |   904.8 |
| doc open        |    1,341 |  8.0 |  34.7 |   549.7 |
| channel history |    1,354 | 24.0 |  58.0 | 1,352.1 |
| search          |    1,031 | 36.9 | 268.7 | 1,457.1 |
| task move       |      681 | 24.3 | 366.5 | 1,783.4 |
| message post    |      674 | 22.1 | 241.7 | 2,076.5 |

Stalls: none at start (ramp holds). Mid-run there are slow windows, 100 requests over 1 s between
t+212 and t+294 s, in 4 bursts (t+212–214, t+245–246, t+261, t+292–294). This is worse than the
earlier ramped run (0 slow requests, p99 74 ms), so the ramp fix holds but the run is not a clean
confirmation. Cause not investigated.

Idle memory gate (330 s hold, 25 sockets): app 165.9 MiB, Postgres 194.1 MiB. Pass.

## Burst investigation (a96b085, instrumented)

Two ramped gates (`RAMP=60s`, `API_VUS=200`) on a fresh stack with Postgres `log_lock_waits`,
`log_checkpoints`, `log_min_duration_statement=250`, and Bun `BUN_JSC_logGC=1`. No request exceeded
1 s in either run, so the earlier t+212–294 s bursts did not reproduce.

- Run 1: API p50 23.7, p95 51.3, p99 73.3, max 185.4 ms.
- Run 2: API p50 23.8, p95 59.2, p99 112.2, max 725.1 ms.

Postgres logged six lock waits in the whole session, all on a `COMMIT` and all on
`AccessExclusiveLock` of a shared `pg_database` object. Each waited 200–530 ms behind a `COMMIT` that
ran 294–580 ms. Run 2 slow API spans (250–724 ms, about 15 requests) fall in the same windows
(15:12:04, 15:12:30, 15:13:00 UTC). Bun GC pauses were sub-millisecond, and checkpoints and
autovacuum did not coincide with the waits.

Cause: that lock is PostgreSQL's notification-queue lock. A transaction that ran `NOTIFY` takes an
`AccessExclusiveLock` on the shared `pg_database` object at commit, so all such commits run one at
a time. The trail-chaining migration had added a trigger that ran `pg_notify` on every trail insert
to wake the chainer, so every command commit queued on that one lock, and under bursts of writes
commits stacked up behind it. Migration `20261120151955_drop_trail_notify` removes the trigger.
The chainer now wakes in process when commands publish their events after commit, and still sweeps
every second. A test asserts that no trigger on `trail_events` calls `NOTIFY`.
