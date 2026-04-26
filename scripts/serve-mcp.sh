#!/usr/bin/env bash
# serve-mcp.sh — Expose the MCP server over HTTP for Docker/remote clients.
#
# Wraps supergateway to bridge stdio MCP to Streamable HTTP, setting the
# correct PATH and workflow config so homebrew-installed tools (xcodegen,
# create-dmg, etc.) are reachable from the child process.
#
# Usage:
#   ./scripts/serve-mcp.sh                        # defaults: port 9090, all workflows
#   ./scripts/serve-mcp.sh --port 8080             # custom port
#   WORKFLOWS="build-tools,simulator" ./scripts/serve-mcp.sh  # specific workflows
#
# Docker client config (.mcp.json inside container):
#   {
#     "mcpServers": {
#       "xcode": {
#         "type": "http",
#         "url": "http://host.docker.internal:<port>/mcp"
#       }
#     }
#   }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- PATH: include common tool locations ---
# homebrew (Apple Silicon + Intel), MacPorts, user-local
for dir in /opt/homebrew/bin /usr/local/bin /opt/local/bin "$HOME/.local/bin"; do
  [[ -d "$dir" ]] && [[ ":$PATH:" != *":$dir:"* ]] && PATH="$dir:$PATH"
done
export PATH

# --- Workflows ---
# Default: all workflows. Override with WORKFLOWS env var.
if [[ -z "${XCODEBUILDMCP_ENABLED_WORKFLOWS:-}" ]]; then
  export XCODEBUILDMCP_ENABLED_WORKFLOWS="${WORKFLOWS:-build-tools,simulator,macos,device,doctor,workflow-discovery,project-discovery,utilities}"
fi

# --- Port ---
PORT=9090
prev_arg=""
for arg in "$@"; do
  if [[ "$prev_arg" == "--port" ]]; then
    PORT="$arg"
  fi
  prev_arg="$arg"
done

# --- Launch ---
echo "MCP server: ${PROJECT_ROOT}/build/cli.js"
echo "Endpoint:   http://localhost:${PORT}/mcp"
echo "Workflows:  ${XCODEBUILDMCP_ENABLED_WORKFLOWS}"
echo "PATH includes: $(which xcodegen 2>/dev/null || echo '(xcodegen not found)'), $(which codesign 2>/dev/null || echo '(codesign not found)')"
echo ""

# Filter out --port from passthrough args to avoid duplication
FILTERED_ARGS=()
skip_next=false
for arg in "$@"; do
  if $skip_next; then
    skip_next=false
    continue
  fi
  if [[ "$arg" == "--port" ]]; then
    skip_next=true
    continue
  fi
  FILTERED_ARGS+=("$arg")
done

# Propagate signals to the entire process group so child processes
# (supergateway -> node mcp) are cleaned up when this script is killed.
cleanup() {
  # Send TERM to our process group (negative PID), excluding ourselves
  trap - TERM INT  # prevent re-entry
  kill -TERM 0 2>/dev/null
  wait
}
trap cleanup TERM INT

npx supergateway \
  --port "$PORT" \
  --stdio "node ${PROJECT_ROOT}/build/cli.js mcp" \
  --outputTransport streamableHttp \
  --stateful \
  --cors \
  ${FILTERED_ARGS[@]+"${FILTERED_ARGS[@]}"} &

wait $!
