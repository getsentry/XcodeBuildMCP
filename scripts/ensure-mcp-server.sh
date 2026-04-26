#!/usr/bin/env bash
# ensure-mcp-server.sh — Start the MCP bridge if not already running.
#
# Idempotent: safe to call on every container start, cron, or manually.
# Checks if port is already in use before spawning.
#
# Usage:
#   ./scripts/ensure-mcp-server.sh              # default port 9090
#   ./scripts/ensure-mcp-server.sh --port 8080   # custom port
#   WORKFLOWS="build-tools" ./scripts/ensure-mcp-server.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=9090

# Parse --port from args
prev_arg=""
for arg in "$@"; do
  if [[ "$prev_arg" == "--port" ]]; then
    PORT="$arg"
  fi
  prev_arg="$arg"
done

# --- PID file management ---
LOG_DIR="${SCRIPT_DIR}/../logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/mcp-server.log"
PID_FILE="${LOG_DIR}/mcp-server-${PORT}.pid"

stop_old_process() {
  if [[ ! -f "$PID_FILE" ]]; then
    return
  fi
  local old_pid
  old_pid=$(cat "$PID_FILE")
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "[ensure-mcp] Stopping previous server (PID $old_pid)..."
    kill -TERM "$old_pid" 2>/dev/null || true
    # Wait up to 5s for graceful shutdown (serve-mcp.sh trap propagates to children)
    local i=0
    while kill -0 "$old_pid" 2>/dev/null && (( i < 10 )); do
      sleep 0.5
      (( i++ ))
    done
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "[ensure-mcp] Force-killing old server (PID $old_pid)..."
      kill -9 "$old_pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
}

# Check if already running and healthy on this port
if [[ -f "$PID_FILE" ]]; then
  old_pid=$(cat "$PID_FILE")
  if kill -0 "$old_pid" 2>/dev/null && lsof -ti :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[ensure-mcp] Server already running (PID $old_pid, port $PORT)"
    exit 0
  fi
  # Stale PID file or port not listening — clean up
  stop_old_process
fi

# Port in use but no PID file — something else owns it
if lsof -ti :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ensure-mcp] ERROR: Port $PORT in use by another process"
  lsof -ti :"$PORT" -sTCP:LISTEN
  exit 1
fi

# --- Launch ---
echo "[ensure-mcp] Starting MCP server on port $PORT..."
nohup "$SCRIPT_DIR/serve-mcp.sh" --port "$PORT" "$@" \
  >> "$LOG_FILE" 2>&1 &

SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait briefly to confirm it started
sleep 2
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[ensure-mcp] MCP server running (PID $SERVER_PID, port $PORT)"
  echo "[ensure-mcp] Log: $LOG_FILE"
else
  echo "[ensure-mcp] ERROR: MCP server failed to start. Check $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
