#!/usr/bin/env bash
# Start backend (FastAPI on BACKEND_PORT) and frontend (Vite on FRONTEND_PORT) together.
# Ctrl-C stops both. Set PYTHON to choose the interpreter used to create .venv.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a; source .env; set +a
fi
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# Python env: create on first run, reinstall when requirements.txt changes.
if [ ! -d .venv ]; then
  "${PYTHON:-python3}" -m venv .venv
fi
if [ ! -f .venv/.req-installed ] || [ requirements.txt -nt .venv/.req-installed ]; then
  .venv/bin/pip install -q -r requirements.txt
  touch .venv/.req-installed
fi

# Node deps: install on first run.
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

.venv/bin/uvicorn backend.main:app --reload --port "$BACKEND_PORT" &
BACKEND_PID=$!
(cd frontend && npm run dev -- --strictPort) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null' EXIT INT TERM
echo "Backend:  http://localhost:$BACKEND_PORT/api/v1/health"
echo "Frontend: http://localhost:$FRONTEND_PORT"
wait
