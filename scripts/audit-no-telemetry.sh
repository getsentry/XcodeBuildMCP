#!/usr/bin/env bash
set -euo pipefail
FAIL=0
RUNTIME_PATHS=(src/cli src/server src/runtime src/core src/mcp src/integrations src/utils src/daemon src/rendering src/types package.json package-lock.json)
CONFIG_PATHS=(.mcp.json)
check_runtime_pattern() {
  local pattern="$1"
  echo "[audit] checking runtime paths for: $pattern"
  if rg -n "$pattern" "${RUNTIME_PATHS[@]}" --glob '!**/__tests__/**' --glob '!**/snapshot-tests/**'; then
    echo "[audit] FAIL: found $pattern"
    FAIL=1
  else
    echo "[audit] PASS: no runtime match"
  fi
}
check_config_pattern() {
  local pattern="$1"
  echo "[audit] checking config paths for: $pattern"
  if rg -n "$pattern" "${CONFIG_PATHS[@]}" 2>/dev/null; then
    echo "[audit] FAIL: found $pattern"
    FAIL=1
  else
    echo "[audit] PASS: no config match"
  fi
}
check_runtime_pattern '@sentry/node'
check_runtime_pattern 'Sentry\.init'
check_runtime_pattern 'wrapMcpServerWithSentry'
check_runtime_pattern 'ingest\.sentry'
check_runtime_pattern 'sentry\.io'
check_runtime_pattern 'raw\.githubusercontent\.com/cameroncooke/xcodemake'
check_runtime_pattern 'api\.github\.com/repos'
check_runtime_pattern 'releases/latest'
check_runtime_pattern 'releases/download'
check_runtime_pattern 'XcodeBuildMCP-(iOS|macOS)-Template'
check_runtime_pattern 'npm view'
check_runtime_pattern 'brew info'
check_runtime_pattern 'fetch\('
check_runtime_pattern '\bcurl\b'
check_runtime_pattern '\bwget\b'
check_config_pattern 'mcp\.sentry\.dev'
if [ "$FAIL" -ne 0 ]; then echo '[audit] failed'; exit 1; fi
echo '[audit] passed'
