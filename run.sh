#!/usr/bin/env bash
# Start the CaseReviewChat frontend (Vite dev server) for Option A.
# Vite proxies /api -> http://localhost:49002 (the backend), so the browser
# only ever talks to this port. --host makes it reachable off-machine.
#
# Usage:
#   ./run.sh                 # run in foreground
#   nohup ./run.sh > frontend.log 2>&1 &   # or run under tmux/systemd to survive logout
set -euo pipefail
cd "$(dirname "$0")"

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

echo "[run.sh] frontend -> http://${FRONTEND_HOST}:${FRONTEND_PORT}   (proxies /api -> localhost:49002)"
exec npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
