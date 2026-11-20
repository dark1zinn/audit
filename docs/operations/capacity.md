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
- Build: `deploy/Dockerfile` image `audit:local`, built from the working tree on top of `f719398`
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

## 5 to 15 s think time (default scenario)

The mixed scenario defaults to 5 to 15 s think time between actions (uniform, mean 10 s). This
was chosen as the gate scenario for the post-fix build. The 0.5 to 1.5 s runs above are kept as a
stress run only.

Runs at 200 API VUs, 5 minutes, post-fix build (`load/mixed.js` defaults):

| Run | API p50 ms | API p95 ms | API p99 ms | Requests | Error rate | p95 gate (under 150 ms)   |
| --- | ---------: | ---------: | ---------: | -------: | ---------: | ------------------------- |
| 4   |       21.9 |       61.7 |    2,601.4 |    6,034 |     0.000% | pass                      |
| 5   |       22.6 |       62.7 |    2,104.5 |    6,051 |     0.000% | pass                      |
| 6   |       23.0 |      124.4 |    2,121.2 |    6,068 |     0.000% | pass overall; writes fail |

Run 5, per endpoint (run 6 p95 in the last column):

| Endpoint        | Requests |  p50 |  p95 |     p99 | Run 6 p95 |
| --------------- | -------: | ---: | ---: | ------: | --------: |
| board view      |    1,494 | 34.5 | 73.9 | 3,052.4 |      78.9 |
| doc open        |    1,232 |  6.9 | 23.9 | 1,792.1 |      29.4 |
| channel history |    1,167 | 12.5 | 33.1 | 2,094.8 |      30.1 |
| search          |      966 | 37.5 | 75.9 |   942.5 |     165.1 |
| task move       |      617 | 22.9 | 74.5 | 1,480.0 |     194.7 |
| message post    |      575 | 20.0 | 63.1 | 1,490.1 |   1,067.3 |

The p95 gate holds for the whole API in all three runs, but run 6 misses it for task move and
message post. Those two endpoints were the ones inside the stall below.

### Where the p99 stall comes from

Run 6 was captured point by point (`k6 --out json`). 175 of 6,097 requests took over 1 s, and all
of them fall in one window of about 1.7 s, 251 s into the run (10:37:36.3 to 10:37:37.98 UTC).
Connection setup is not involved (`http_req_connecting` p99 1.6 ms), so the time is server-side
(`http_req_waiting`).

The app log for that window shows a burst of about 25 searches and about 50 writes arriving within
roughly one second. Each has a server span of 0.7 to 1.7 s, and the writes complete one after
another about 6 ms apart. Measured separately:

- Writes serialize. Every trail entry takes `pg_advisory_xact_lock('audit:trail_events')` in the
  `trail_events_chain` trigger, held until the command's transaction commits. With 30 concurrent
  writers the server sustained 82 posts per second (1,238 in 15 s, p50 347 ms, p99 727 ms), about
  12 ms of serialized time per write. Board reads running alongside had p50 515 ms.
- Requests then queue for pool connections. The app pool is 10 connections with no acquire
  timeout, and writers hold a connection while they wait on the lock.
- Ruled out: Postgres lock waits (none over 1 s), errors, and slow statements (20 statements over
  200 ms in the whole run); connection setup; CPU throttling (51 throttle events on the app
  cgroup since it started); fsync (sync 8 KB writes take about 1.5 ms).
- Not established: what produced the burst at about 35 s into the window. It is either a
  synchronized arrival from the load client or a short app pause before it. The server log
  alone does not separate the two.

Change made: trail entries are no longer chained inside the command transaction. A command
inserts its trail rows with a sequence number (`seq`) and no chain position, so it takes no
global lock. A background chainer (`trailChainer`, started by `audit serve`) assigns chain
positions in `seq` order under its own advisory lock, after the commit. It wakes on a
`NOTIFY audit_trail` and sweeps once a second. Rows are verifiable once chained; an entry left
unchained for more than 60 seconds makes `audit trail verify` fail, which reports a stopped
chainer. The 82 posts per second figure above is the measurement before this change.

Host disk: the root filesystem was 99% full (2.5 GB free) during these runs.

Idle memory gate (25 realtime sockets, 330 s hold, run 6 build): app 170.9 MiB, Postgres 212.9 MiB,
total about 384 MiB. Pass.

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
