#!/usr/bin/env bash
set -Eeuo pipefail

task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_project_dir="$(cd "${task_script_dir}/.." && pwd)"
task_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/e-finance-resilience.XXXXXX")"
task_preview_pid=""

cleanup() {
  if [[ -n "${task_preview_pid}" ]] && kill -0 "${task_preview_pid}" 2>/dev/null; then
    kill "${task_preview_pid}" 2>/dev/null || true
    wait "${task_preview_pid}" 2>/dev/null || true
  fi

  case "${task_temp_dir}" in
    "${TMPDIR:-/tmp}"/e-finance-resilience.*)
      rm -rf -- "${task_temp_dir}"
      ;;
  esac
}

trap cleanup EXIT
trap 'exit 130' INT TERM

cd "${task_project_dir}"

echo "[1/6] Validação estrutural do source"
npm run lint

echo "[2/6] TypeScript"
npm run typecheck

if [[ "${RESILIENCE_SKIP_BUILD:-0}" == "1" ]]; then
  echo "[3/6] Build reutilizado por RESILIENCE_SKIP_BUILD=1"
else
  echo "[3/6] Build de produção"
  npm run build
fi

echo "[4/6] Validação estrutural do bundle"
node scripts/validate-frontend-resilience.mjs --dist

task_preview_port="$(node -e '
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')"
task_preview_url="http://127.0.0.1:${task_preview_port}"
task_preview_log="${task_temp_dir}/preview.log"

echo "[5/6] Preview isolado em ${task_preview_url}"
npx vite preview \
  --host 127.0.0.1 \
  --port "${task_preview_port}" \
  --strictPort \
  >"${task_preview_log}" 2>&1 &
task_preview_pid=$!

task_preview_ready=0
for _attempt in $(seq 1 80); do
  if curl --fail --silent --show-error "${task_preview_url}/" >/dev/null 2>&1; then
    task_preview_ready=1
    break
  fi
  if ! kill -0 "${task_preview_pid}" 2>/dev/null; then
    echo "Preview encerrou antes de ficar disponível:"
    sed -n '1,160p' "${task_preview_log}"
    exit 1
  fi
  sleep 0.25
done

if [[ "${task_preview_ready}" != "1" ]]; then
  echo "Preview não respondeu dentro de 20 segundos:"
  sed -n '1,160p' "${task_preview_log}"
  exit 1
fi

echo "[6/6] Playwright funcional sem acesso ao Supabase real"
PLAYWRIGHT_BASE_URL="${task_preview_url}" \
PLAYWRIGHT_EXTERNAL_SERVER=1 \
PLAYWRIGHT_JSON_TIER="${PLAYWRIGHT_JSON_TIER:-resilience}" \
npx playwright test \
  e2e/regression/frontend-resilience.spec.ts \
  --project=chromium \
  --no-deps \
  --workers=1

echo "Gate de resiliência aprovado: deploy liberado."
