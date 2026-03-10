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
PROJECT="tribal-pillar-476701-a3"
REGION="us-west1"
SERVICE="e-finance-bot"
IMAGE="us-west1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"
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
  --timeout=60 \
  --set-env-vars="UAZAPI_SERVER_URL=${UAZAPI_SERVER_URL}" \
  --set-secrets="UAZAPI_INSTANCE_TOKEN=UAZAPI_INSTANCE_TOKEN:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,SUPABASE_URL=SUPABASE_URL_EFINANCE:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY_EFINANCE:latest,GEMINI_API_KEY=GEMINI_API_KEY_EFINANCE:latest,SCHEDULER_SECRET=SCHEDULER_SECRET:latest" \
  --quiet

# ── Configurar webhooks ───────────────────────────────────
step "Configurando webhooks..."
URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)")

curl -s -X POST "${URL}/setup" \
  -H "Content-Type: application/json" \
  -d "{\"webhookBaseUrl\": \"${URL}\"}" | grep -q '"status":"done"' \
  && ok "Webhooks configurados" \
  || echo -e "${YELLOW}⚠ Webhook setup retornou resposta inesperada (verifique manualmente)${NC}"

# ── Resultado ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Deploy do bot concluído com sucesso!  ${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "  Tag:     ${TAG}"
echo -e "  URL:     ${URL}"
echo -e "  Health:  ${URL}/health"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
