#!/usr/bin/env bash
set -Eeuo pipefail

task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_project_dir="$(cd "${task_script_dir}/.." && pwd)"
task_production_url="${FRONTEND_PRODUCTION_URL:-https://e-finance-eight.vercel.app}"
task_production_url="${task_production_url%/}"
task_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/e-finance-production.XXXXXX")"

cleanup() {
  case "${task_temp_dir}" in
    "${TMPDIR:-/tmp}"/e-finance-production.*)
      rm -rf -- "${task_temp_dir}"
      ;;
  esac
}

trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ ! "${task_production_url}" =~ ^https://[^/]+$ ]]; then
  echo "FRONTEND_PRODUCTION_URL deve ser uma origem HTTPS sem caminho: ${task_production_url}" >&2
  exit 1
fi

cd "${task_project_dir}"

fetch_production_file() {
  local request_path="$1"
  local output_file="$2"
  local header_file="$3"

  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 10 \
    --max-time 30 \
    --dump-header "${header_file}" \
    --output "${output_file}" \
    "${task_production_url}${request_path}"
}

assert_cache_contains() {
  local header_file="$1"
  local expected_value="$2"
  local request_path="$3"
  local cache_value

  cache_value="$(tr -d '\r' < "${header_file}" \
    | awk -F': ' 'tolower($1) == "cache-control" { print tolower($2) }' \
    | tail -n 1)"
  echo "${request_path}: cache-control=${cache_value}"
  if [[ "${cache_value}" != *"${expected_value}"* ]]; then
    echo "Cache-Control inválido em ${request_path}; esperado conter ${expected_value}" >&2
    exit 1
  fi
}

echo "[1/4] Bootstrap público e origem Vercel"
fetch_production_file "/" "${task_temp_dir}/index.html" "${task_temp_dir}/root.headers"
grep -qi '^server: Vercel' "${task_temp_dir}/root.headers"
grep -q 'data-testid="pre-react-fallback"' "${task_temp_dir}/index.html"
grep -q 'Não foi possível abrir o sistema' "${task_temp_dir}/index.html"
grep -q 'Limpar cache e tentar novamente' "${task_temp_dir}/index.html"

task_main_asset="$(grep -oE 'src="/assets/index-[^"]+\.js"' "${task_temp_dir}/index.html" \
  | head -n 1 \
  | cut -d'"' -f2)"
if [[ -z "${task_main_asset}" ]]; then
  echo "Bundle principal com hash não encontrado no HTML de produção" >&2
  exit 1
fi

echo "[2/4] Assets publicados e service worker recuperável"
fetch_production_file "/index.html" "${task_temp_dir}/index-explicit.html" "${task_temp_dir}/index.headers"
fetch_production_file "/service-worker.js" "${task_temp_dir}/service-worker.js" "${task_temp_dir}/service-worker.headers"
fetch_production_file "/env-config.js" "${task_temp_dir}/env-config.js" "${task_temp_dir}/env-config.headers"
fetch_production_file "${task_main_asset}" "${task_temp_dir}/main.js" "${task_temp_dir}/main.headers"

test -s "${task_temp_dir}/main.js"
grep -q 'caches.delete(cacheName)' "${task_temp_dir}/service-worker.js"

echo "[3/4] Política de cache contra bootstrap obsoleto"
assert_cache_contains "${task_temp_dir}/root.headers" "no-cache" "/"
assert_cache_contains "${task_temp_dir}/index.headers" "no-cache" "/index.html"
assert_cache_contains "${task_temp_dir}/service-worker.headers" "no-cache" "/service-worker.js"
assert_cache_contains "${task_temp_dir}/env-config.headers" "no-cache" "/env-config.js"
assert_cache_contains "${task_temp_dir}/main.headers" "immutable" "${task_main_asset}"

echo "[4/4] Playwright funcional no bundle de produção, sem acesso ao Supabase real"
PLAYWRIGHT_BASE_URL="${task_production_url}" \
PLAYWRIGHT_EXTERNAL_SERVER=1 \
PLAYWRIGHT_JSON_TIER="${PLAYWRIGHT_JSON_TIER:-production-resilience}" \
npx playwright test \
  e2e/regression/frontend-resilience.spec.ts \
  --project=chromium \
  --no-deps \
  --workers=1

echo "Produção Vercel aprovada em ${task_production_url}."
