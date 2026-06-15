#!/usr/bin/env bash
# ============================================================
# deploy-bot.sh — e-finance-bot → Google Cloud Run
# Uso: ./deploy-bot.sh [--skip-tests]
# ============================================================
set -euo pipefail

SKIP_TESTS=false
for arg in "$@"; do
  [[ "$arg" == "--skip-tests" ]] && SKIP_TESTS=true
done

# ── Configurações ─────────────────────────────────────────
# Região sa-east-1 (São Paulo) — mesma do Supabase, elimina latência cross-region
# nas leituras de DB (antes us-west1 ↔ sa-east-1 custava 5-13s por turno).
PROJECT="tribal-pillar-476701-a3"
REGION="southamerica-east1"
SERVICE="e-finance-bot"
IMAGE="southamerica-east1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"
UAZAPI_SERVER_URL="https://processai.uazapi.com"

# ── Helpers ───────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step()  { echo -e "\n${YELLOW}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Mudar para o diretório do bot ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Pre-checks ────────────────────────────────────────────
step "Verificando dependências..."
command -v docker  >/dev/null 2>&1 || fail "docker não encontrado"
command -v gcloud  >/dev/null 2>&1 || fail "gcloud não encontrado"
command -v npm     >/dev/null 2>&1 || fail "npm não encontrado"
ok "docker, gcloud e npm presentes"

# ── Instalar dependências ─────────────────────────────────
step "Instalando dependências npm..."
npm ci --silent
ok "Dependências instaladas"

# ── Testes ───────────────────────────────────────────────
if [[ "$SKIP_TESTS" == "false" ]]; then
  step "Executando testes (vitest)..."
  npm test || fail "Testes falharam — corrija antes de deployar"
  ok "Todos os testes passaram"
else
  echo -e "${YELLOW}⚠ Testes ignorados (--skip-tests)${NC}"
fi

# ── TypeScript check ──────────────────────────────────────
step "Verificando TypeScript..."
npm run build || fail "Build TypeScript falhou"
ok "TypeScript ok"

# ── Auth Docker ───────────────────────────────────────────
step "Autenticando Docker no Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
ok "Docker autenticado"

# ── Build & Push ──────────────────────────────────────────
TAG=$(date +%Y%m%d-%H%M%S)
FULL_IMAGE="${IMAGE}:${TAG}"

step "Build da imagem Docker (tag: ${TAG})..."
docker build \
  --tag "${FULL_IMAGE}" \
  --tag "${IMAGE}:latest" \
  .
ok "Build concluído"

step "Push para Artifact Registry..."
docker push "${FULL_IMAGE}"
docker push "${IMAGE}:latest"
ok "Push concluído"

# ── Deploy ────────────────────────────────────────────────
step "Deploy no Cloud Run (${SERVICE} @ ${REGION})..."
gcloud run deploy "${SERVICE}" \
  --image="${FULL_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=120 \
  --set-env-vars="UAZAPI_SERVER_URL=${UAZAPI_SERVER_URL},AI_NATIVE_ENABLED=true,AI_NATIVE_TENANT_ALLOWLIST=64978efa-def2-4cdb-adb6-b641fc1935d1" \
  --set-secrets="UAZAPI_INSTANCE_TOKEN=UAZAPI_INSTANCE_TOKEN:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,SETUP_SECRET=SETUP_SECRET:latest,TELEGRAM_WEBHOOK_SECRET_TOKEN=TELEGRAM_WEBHOOK_SECRET_TOKEN:latest,UAZAPI_WEBHOOK_SECRET=UAZAPI_WEBHOOK_SECRET:latest,SUPABASE_URL=SUPABASE_URL_EFINANCE:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY_EFINANCE:latest,GEMINI_API_KEY=GEMINI_API_KEY_EFINANCE:latest,SCHEDULER_SECRET=SCHEDULER_SECRET:latest" \
  --quiet

# ── Configurar webhooks ───────────────────────────────────
step "Configurando webhooks..."
URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)")
SETUP_SECRET_VALUE=$(gcloud secrets versions access latest --secret=SETUP_SECRET --project="${PROJECT}")

gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --update-env-vars="BOT_BASE_URL=${URL}" \
  --quiet

if curl -fsS -X POST "${URL}/setup" \
  -H "Content-Type: application/json" \
  -H "x-setup-secret: ${SETUP_SECRET_VALUE}" \
  -d '{}' | grep -q '"status":"done"'; then
  ok "Webhooks configurados"
else
  fail "Webhook setup retornou resposta inesperada"
fi

# ── Cloud Scheduler (morning-briefing) ───────────────────
step "Configurando Cloud Scheduler (morning-briefing)..."
SCHEDULER_SECRET_VALUE=$(gcloud secrets versions access latest \
  --secret=SCHEDULER_SECRET --project="${PROJECT}" 2>/dev/null) || {
  echo -e "${YELLOW}⚠ Não foi possível ler SCHEDULER_SECRET — Cloud Scheduler não configurado${NC}"
  SCHEDULER_SECRET_VALUE=""
}

if [[ -n "${SCHEDULER_SECRET_VALUE}" ]]; then
  # Reusa a URL dinâmica obtida do `gcloud run services describe` acima — antes
  # estava hardcoded apontando pra us-west1, o que quebrava após a migração para sa-east-1.
  BOT_URL="${URL}"

  ensure_scheduler_job() {
    local NAME="$1"
    local SCHEDULE="$2"
    local PATH_SUFFIX="$3"
    if gcloud scheduler jobs describe "${NAME}" \
         --project="${PROJECT}" --location="${REGION}" &>/dev/null; then
      gcloud scheduler jobs update http "${NAME}" \
        --project="${PROJECT}" --location="${REGION}" \
        --uri="${BOT_URL}${PATH_SUFFIX}" \
        --update-headers="x-scheduler-secret=${SCHEDULER_SECRET_VALUE},Content-Type=application/json" \
        --quiet
      ok "Cloud Scheduler job '${NAME}' atualizado"
    else
      gcloud scheduler jobs create http "${NAME}" \
        --project="${PROJECT}" --location="${REGION}" \
        --schedule="${SCHEDULE}" \
        --uri="${BOT_URL}${PATH_SUFFIX}" \
        --http-method=POST \
        --headers="x-scheduler-secret=${SCHEDULER_SECRET_VALUE},Content-Type=application/json" \
        --message-body="{}" \
        --time-zone="America/Sao_Paulo" \
        --attempt-deadline=60s \
        --quiet
      ok "Cloud Scheduler job '${NAME}' criado (${SCHEDULE})"
    fi
  }

  ensure_scheduler_job "morning-briefing"   "*/5 * * * *"  "/scheduler/morning-briefing"
  ensure_scheduler_job "eod-alert"          "*/5 * * * *"  "/scheduler/payment-followup"
  ensure_scheduler_job "feature-promotions" "*/30 * * * *" "/scheduler/feature-promotions"
fi

# ── Resultado ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Deploy do bot concluído com sucesso!  ${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "  Tag:     ${TAG}"
echo -e "  URL:     ${URL}"
echo -e "  Health:  ${URL}/health"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
