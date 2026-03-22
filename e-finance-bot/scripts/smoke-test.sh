#!/usr/bin/env bash
# smoke-test.sh — testa as capacidades principais do bot
#
# Modos:
#   --pre-deploy   Payload sintético direto no webhook (não passa pelo UazAPI)
#   --post-deploy  Mensagem real via instância Guilherme → Salomão (UazAPI)
#
# Uso:
#   ./scripts/smoke-test.sh --pre-deploy
#   ./scripts/smoke-test.sh --post-deploy
#   BOT_URL=http://localhost:8080 ./scripts/smoke-test.sh --pre-deploy

set -euo pipefail

# ── Configurações ──────────────────────────────────────────────────────────────
BOT_URL="${BOT_URL:-https://e-finance-bot-oh6s7bvufq-uw.a.run.app}"
UAZAPI_URL="${UAZAPI_SERVER_URL:-https://processai.uazapi.com}"
WHATSAPP_WEBHOOK_SECRET="${UAZAPI_WEBHOOK_SECRET:-}"
GUILHERME_TOKEN="${GUILHERME_TOKEN:-}"

# Instância Guilherme (arma de teste) — token para disparar mensagens
GUILHERME_NUMBER="558591318582"

# Instância Salomão (alvo) — número que recebe as mensagens
SALOMAO_NUMBER="558520284195"

# Sender usado nos testes sintéticos (deve ser um usuário linkado ao tenant de teste)
SYNTHETIC_SENDER="${TEST_SENDER:-5585991318582@s.whatsapp.net}"
SYNTHETIC_OWNER="${OWNER_NUMBER:-558520284195}"

# Tempo de espera entre mensagens (segundos)
WAIT_BETWEEN=8

# ── Cores ──────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0

# ── Helpers ────────────────────────────────────────────────────────────────────
pass() { echo -e "${GREEN}  ✓ PASS${NC} — $*"; ((PASS++)); }
fail() { echo -e "${RED}  ✗ FAIL${NC} — $*"; ((FAIL++)); }
step() { echo -e "\n${YELLOW}▶ $*${NC}"; }
wait_bot() { echo "  ⏳ Aguardando ${WAIT_BETWEEN}s..."; sleep $WAIT_BETWEEN; }

# Envia payload sintético direto no webhook do bot
send_synthetic() {
  local MSG="$1"
  local MSG_ID="SMOKE-$(date +%s%N | cut -c1-13)"
  curl -s -o /dev/null -w "%{http_code}" -X POST "$BOT_URL/webhook/whatsapp/${WHATSAPP_WEBHOOK_SECRET}" \
    -H "Content-Type: application/json" \
    -H "x-uazapi-webhook-secret: ${WHATSAPP_WEBHOOK_SECRET}" \
    -d "{
      \"chatid\": \"$SYNTHETIC_SENDER\",
      \"text\": \"$MSG\",
      \"messageType\": \"extendedTextMessage\",
      \"sender\": \"$SYNTHETIC_SENDER\",
      \"senderName\": \"SmokeTest\",
      \"fromMe\": false,
      \"messageTimestamp\": $(date +%s),
      \"messageid\": \"$MSG_ID\",
      \"owner\": \"$SYNTHETIC_OWNER\",
      \"isGroup\": false
    }"
}

# Envia mensagem real via instância Guilherme → Salomão
send_real() {
  local MSG="$1"
  curl -s -o /dev/null -w "%{http_code}" -X POST "$UAZAPI_URL/send/text" \
    -H "token: $GUILHERME_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"number\":\"$SALOMAO_NUMBER\",\"text\":\"$MSG\"}"
}

# Verifica se nos logs do Cloud Run apareceu processamento recente
check_logs() {
  local KEYWORD="$1"
  local RESULT
  RESULT=$(gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=e-finance-bot" \
    --limit=10 --format="json" \
    --project=tribal-pillar-476701-a3 --freshness=2m 2>/dev/null \
    | python3 -c "
import json,sys
try:
  logs=json.load(sys.stdin)
  for e in logs:
    p=str(e.get('jsonPayload',e.get('textPayload','')))
    if '$KEYWORD' in p:
      print('found')
      break
except: pass
" 2>/dev/null || echo "")
  [[ "$RESULT" == "found" ]]
}

# ── Parse modo ─────────────────────────────────────────────────────────────────
MODE="${1:-}"
if [[ "$MODE" != "--pre-deploy" && "$MODE" != "--post-deploy" ]]; then
  echo "Uso: $0 [--pre-deploy|--post-deploy]"
  echo ""
  echo "  --pre-deploy   Payload sintético direto no webhook (sem UazAPI)"
  echo "  --post-deploy  Mensagem real via Guilherme → Salomão (UazAPI)"
  exit 1
fi

if [[ "$MODE" == "--pre-deploy" && -z "$WHATSAPP_WEBHOOK_SECRET" ]]; then
  echo -e "${RED}Falta UAZAPI_WEBHOOK_SECRET no ambiente para validar o webhook${NC}"
  exit 1
fi

if [[ "$MODE" == "--post-deploy" && -z "$GUILHERME_TOKEN" ]]; then
  echo -e "${RED}Falta GUILHERME_TOKEN (ou UAZAPI_INSTANCE_TOKEN) no ambiente para o teste real${NC}"
  exit 1
fi

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}════════════════════════════════════════════${NC}"
if [[ "$MODE" == "--pre-deploy" ]]; then
  echo -e "${YELLOW}  🧪 SMOKE TEST — PRÉ-DEPLOY (sintético)${NC}"
  echo -e "  Bot: $BOT_URL"
else
  echo -e "${YELLOW}  🔫 SMOKE TEST — PÓS-DEPLOY (real)${NC}"
  echo -e "  Guilherme → Salomão (${SALOMAO_NUMBER})"
fi
echo -e "${YELLOW}════════════════════════════════════════════${NC}"

# ── Teste 1: Health check ──────────────────────────────────────────────────────
step "1/6 — Health check"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BOT_URL/health")
BODY=$(curl -s "$BOT_URL/health")
if [[ "$HTTP" == "200" && "$BODY" == *"healthy"* ]]; then
  pass "GET /health → $BODY"
else
  fail "GET /health retornou HTTP $HTTP: $BODY"
fi

# ── Testes 2-6: Mensagens ──────────────────────────────────────────────────────
declare -a MSGS=(
  "oi"
  "quem tenho que cobrar hoje?"
  "quanto tenho pra receber amanhã?"
  "tem alguma parcela em atraso?"
  "dashboard"
)
declare -a LABELS=(
  "Saudação → menu de ajuda"
  "Cobranças de hoje"
  "Recebíveis amanhã"
  "Parcelas em atraso"
  "Dashboard"
)

for i in "${!MSGS[@]}"; do
  TEST_NUM=$((i + 2))
  MSG="${MSGS[$i]}"
  LABEL="${LABELS[$i]}"

  step "${TEST_NUM}/6 — ${LABEL}"
  echo "  → Enviando: \"$MSG\""

  if [[ "$MODE" == "--pre-deploy" ]]; then
    HTTP=$(send_synthetic "$MSG")
    wait_bot
    if [[ "$HTTP" == "200" || "$HTTP" == "202" ]]; then
      pass "Webhook aceito (HTTP $HTTP)"
    else
      fail "Webhook rejeitou com HTTP $HTTP"
    fi
  else
    HTTP=$(send_real "$MSG")
    wait_bot
    if [[ "$HTTP" == "200" ]]; then
      pass "Mensagem enviada via UazAPI (HTTP $HTTP)"
    else
      fail "UazAPI rejeitou com HTTP $HTTP"
    fi
  fi
done

# ── Verificar logs (pós-deploy) ────────────────────────────────────────────────
if [[ "$MODE" == "--post-deploy" ]]; then
  step "Verificando logs do Cloud Run..."
  if command -v gcloud &>/dev/null; then
    if check_logs "bot_message_processed"; then
      pass "Logs confirmam: bot_message_processed encontrado nos últimos 2min"
    else
      fail "bot_message_processed NÃO encontrado nos logs recentes (verifique webhook UazAPI)"
    fi
  else
    echo -e "  ${YELLOW}⚠ gcloud não encontrado — pule a verificação de logs${NC}"
  fi
fi

# ── Resultado final ────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}  ✅ SMOKE TEST PASSOU — ${PASS}/${TOTAL} testes OK${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}  ❌ SMOKE TEST FALHOU — ${FAIL}/${TOTAL} testes falharam${NC}"
  EXIT_CODE=1
fi
echo -e "${YELLOW}════════════════════════════════════════════${NC}"
echo ""

# Dica pós-deploy
if [[ "$MODE" == "--post-deploy" && $FAIL -eq 0 ]]; then
  echo -e "  Verifique as respostas no WhatsApp do número ${SALOMAO_NUMBER}"
  echo -e "  ou consulte os logs:"
  echo -e "  gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=e-finance-bot' --limit=20 --format=json --project=tribal-pillar-476701-a3 --freshness=5m"
  echo ""
fi

exit $EXIT_CODE
