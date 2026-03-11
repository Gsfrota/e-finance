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
# Lê GEMINI_API_KEY do Secret Manager (ou do ambiente se já definida)
if [ -z "${GEMINI_API_KEY:-}" ]; then
  GEMINI_API_KEY=$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project="${PROJECT}" 2>/dev/null) \
    || { echo "Erro: não foi possível ler GEMINI_API_KEY do Secret Manager"; exit 1; }
fi

# ── Helpers ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step()  { echo -e "\n${YELLOW}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

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
  --no-cache \
  --build-arg GEMINI_API_KEY="${GEMINI_API_KEY}" \
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
  --set-env-vars="API_KEY=${GEMINI_API_KEY}" \
  --update-secrets="SUPABASE_KEY=SUPABASE_KEY_EFINANCE:1,SUPABASE_URL=SUPABASE_URL_EFINANCE:1" \
  --quiet

# ── Resultado ─────────────────────────────────────────────────
URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)")

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Deploy concluído com sucesso!    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "  Tag:  ${TAG}"
echo -e "  URL:  ${URL}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
