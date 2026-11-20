#!/usr/bin/env bash
# Idle memory gate: 25 people hold `/rpc` and `/collab` sockets with no other traffic.
# Samples `docker stats` five minutes after the sockets are up. Requires the stack from
# deploy/compose.yml to be running with the app container named audit-app-1.
#
#   bash load/memory.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${RESULTS_DIR:-/tmp/perf-results}"
HOLD="${HOLD_SECONDS:-330}"
AUDIT_URL="${AUDIT_URL:-http://localhost:3000}"
mkdir -p "$OUT"
LOG="$OUT/idle.log"

docker run --rm --network host \
  -e HOLD_SECONDS="$HOLD" -e AUDIT_URL="$AUDIT_URL" \
  -v "$HERE:/scripts:ro" -v "$OUT:/results" \
  grafana/k6 run --summary-export /results/idle.json /scripts/idle.js >"$LOG" 2>&1 &
K6_PID=$!

# Wait for setup (sign-ins and socket opens) to finish before sampling.
until grep -q "IDLE-START" "$LOG" 2>/dev/null; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    echo "k6 exited before IDLE-START" >&2
    exit 1
  fi
  sleep 2
done

# Five minutes after the sockets are up.
sleep 300

docker stats --no-stream audit-app-1 audit-postgres-1 | tee "$OUT/idle-stats.txt"

wait "$K6_PID"
K6_EXIT=$?
echo "k6 exit code: $K6_EXIT"
exit "$K6_EXIT"
