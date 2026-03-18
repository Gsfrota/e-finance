#!/usr/bin/env bash
# ============================================================
# deploy.sh — E-Finance → Google Cloud Run
# Uso: ./deploy.sh
# ============================================================
set -euo pipefail

# ── Configurações ────────────────────────────────────────────
PROJECT="tribal-pillar-476701-a3"
REGION="us-west1"
SERVICE="e-finance"
IMAGE="us-west1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"
# ── Helpers ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step()  { echo -e "\n${YELLOW}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── QA Pre-Deploy Gate ──────────────────────────────────────
if [ "${PRE_DEPLOY_SKIP:-}" != "1" ]; then
  step "Executando pipeline de QA pre-deploy..."
  if ! bash "$(dirname "$0")/scripts/pre-deploy-qa.sh"; then
    fail "QA pre-deploy falhou. Use PRE_DEPLOY_SKIP=1 ./deploy.sh para pular."
  fi
  ok "QA pre-deploy aprovado"
fi

# ── Pre-checks ───────────────────────────────────────────────
step "Verificando dependências..."
command -v docker >/dev/null 2>&1 || fail "docker não encontrado"
command -v gcloud >/dev/null 2>&1 || fail "gcloud não encontrado"
ok "docker e gcloud presentes"

step "Autenticando Docker no Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
ok "Docker autenticado"

# ── Build ─────────────────────────────────────────────────────
TAG=$(date +%Y%m%d-%H%M%S)
FULL_IMAGE="${IMAGE}:${TAG}"

step "Build da imagem Docker (tag: ${TAG})..."
docker build \
  --tag "${FULL_IMAGE}" \
  --tag "${IMAGE}:latest" \
  .
ok "Build concluído"

# ── Push ──────────────────────────────────────────────────────
step "Push para Artifact Registry..."
docker push "${FULL_IMAGE}"
docker push "${IMAGE}:latest"
ok "Push concluído"

# ── Deploy ────────────────────────────────────────────────────
step "Deploy no Cloud Run (${SERVICE} @ ${REGION})..."
gcloud run deploy "${SERVICE}" \
  --image="${FULL_IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --platform=managed \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --cpu=1 \
  --port=8080 \
  --update-secrets="SUPABASE_KEY=SUPABASE_KEY_EFINANCE:1,SUPABASE_URL=SUPABASE_URL_EFINANCE:1" \
  --quiet

# ── Resultado ─────────────────────────────────────────────────
URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)")

REVISION=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.latestReadyRevisionName)")

# ── Health Check ──────────────────────────────────────────────
step "Health check pós-deploy..."
MAX_ATTEMPTS=6
ATTEMPT=0
HTTP_STATUS=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${URL}" 2>/dev/null || echo "000")
  if [ "${HTTP_STATUS}" = "200" ]; then
    ok "Health check OK (HTTP ${HTTP_STATUS})"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    echo -e "  Aguardando container inicializar... (${ATTEMPT}/${MAX_ATTEMPTS}) HTTP ${HTTP_STATUS}"
    sleep 5
  fi
done

if [ "${HTTP_STATUS}" != "200" ]; then
  fail "Health check falhou após ${MAX_ATTEMPTS} tentativas (último status: HTTP ${HTTP_STATUS}). Verifique os logs: gcloud logging read 'resource.labels.service_name=${SERVICE}' --limit=20 --project=${PROJECT}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Deploy concluído com sucesso!    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "  Tag:      ${TAG}"
echo -e "  Revisão:  ${REVISION}"
echo -e "  URL:      ${URL}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
