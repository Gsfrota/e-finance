#!/usr/bin/env bash
set -euo pipefail

PROMPT="${1:-}"
if [ -z "$PROMPT" ]; then
  echo "uso: scripts/claude-agent.sh 'seu prompt'" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

resolve_claude_bin() {
  if command -v claude >/dev/null 2>&1; then
    command -v claude
    return 0
  fi

  local native_bin="$HOME/.vscode-server/extensions/anthropic.claude-code-2.1.76-linux-x64/resources/native-binary/claude"
  if [ -x "$native_bin" ]; then
    printf '%s\n' "$native_bin"
    return 0
  fi

  echo "claude nao encontrado no PATH nem no caminho nativo esperado" >&2
  exit 1
}

CLAUDE_BIN="$(resolve_claude_bin)"

if [ -f "$HOME/.secrets/mcp.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.secrets/mcp.env"
fi

PROJECT_REF="${CLAUDE_SUPABASE_PROJECT_REF:-${SUPABASE_PROJECT_REF:-enzgerrnlbiojkuzeilw}}"
TMP_MCP=""

cleanup() {
  if [ -n "$TMP_MCP" ] && [ -f "$TMP_MCP" ]; then
    rm -f "$TMP_MCP"
  fi
}
trap cleanup EXIT

CLAUDE_ARGS=(
  -p
  "$PROMPT"
  --output-format
  json
  --permission-mode
  bypassPermissions
  --allowedTools
  "Bash,Read,Edit,mcp__supabase__list_tables,mcp__supabase__execute_sql,mcp__supabase__list_migrations,mcp__supabase__get_project_url"
)

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "$PROJECT_REF" ]; then
  TMP_MCP="$(mktemp)"
  cat > "$TMP_MCP" <<JSON
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=${PROJECT_REF}&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage",
      "headers": {
        "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
JSON
  CLAUDE_ARGS+=(
    --mcp-config
    "$TMP_MCP"
    --strict-mcp-config
  )
fi

cd "$PROJECT_DIR"
exec "$CLAUDE_BIN" "${CLAUDE_ARGS[@]}"
