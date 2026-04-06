#!/usr/bin/env bash
# Relatório de testes E2E para Telegram
# Envia resumo de resultados + screenshots de falhas via Telegram Bot API
# Variáveis obrigatórias: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# Variáveis opcionais: GITHUB_SHA, GITHUB_ACTOR, GITHUB_RUN_URL

set -euo pipefail

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"

if [[ -z "$TOKEN" || -z "$CHAT_ID" ]]; then
  echo "[telegram-report] Sem TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID — pulando."
  exit 0
fi

SHA_SHORT="${GITHUB_SHA:0:7}"
ACTOR="${GITHUB_ACTOR:-unknown}"
RUN_URL="${GITHUB_RUN_URL:-}"

# ─── Agregação de resultados ───────────────────────────────────────────────
total_passed=0
total_failed=0
total_skipped=0
tier_lines=""

for tier in 1 2; do
  json_file="test-results/tier${tier}-results.json"
  if [[ ! -f "$json_file" ]]; then
    tier_lines+="  Tier ${tier}: ⚠️ sem dados\n"
    continue
  fi

  passed=$(python3 -c "
import json, sys
d = json.load(open('$json_file'))
print(sum(1 for s in d.get('suites',[]) for spec in s.get('specs',[]) for t in spec.get('tests',[]) if t.get('status') == 'passed'))
" 2>/dev/null || echo 0)

  failed=$(python3 -c "
import json, sys
d = json.load(open('$json_file'))
print(sum(1 for s in d.get('suites',[]) for spec in s.get('specs',[]) for t in spec.get('tests',[]) if t.get('status') in ('failed','timedOut')))
" 2>/dev/null || echo 0)

  skipped=$(python3 -c "
import json, sys
d = json.load(open('$json_file'))
print(sum(1 for s in d.get('suites',[]) for spec in s.get('specs',[]) for t in spec.get('tests',[]) if t.get('status') == 'skipped'))
" 2>/dev/null || echo 0)

  total_passed=$((total_passed + passed))
  total_failed=$((total_failed + failed))
  total_skipped=$((total_skipped + skipped))

  if [[ "$failed" -gt 0 ]]; then
    icon="❌"
  else
    icon="✅"
  fi
  tier_lines+="  ${icon} Tier ${tier}: ${passed} ok | ${failed} falhas | ${skipped} pulados\n"
done

# ─── Status geral ─────────────────────────────────────────────────────────
if [[ "$total_failed" -gt 0 ]]; then
  overall="❌ *FALHOU*"
else
  overall="✅ *PASSOU*"
fi

# ─── Montar mensagem ──────────────────────────────────────────────────────
MSG="🧪 *Testes E2E — ${overall}*

Commit: \`${SHA_SHORT}\` por ${ACTOR}

*Resultados por tier:*
$(echo -e "$tier_lines")
*Total:* ${total_passed} ok | ${total_failed} falhas | ${total_skipped} pulados"

if [[ -n "$RUN_URL" ]]; then
  MSG+="

🔍 [Ver detalhes no GitHub Actions](${RUN_URL})"
fi

# Enviar mensagem de resumo
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{
    \"chat_id\": \"${CHAT_ID}\",
    \"text\": $(echo "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    \"parse_mode\": \"Markdown\",
    \"disable_web_page_preview\": true
  }" > /dev/null

# ─── Screenshots de falhas ────────────────────────────────────────────────
if [[ "$total_failed" -eq 0 ]]; then
  echo "[telegram-report] Nenhuma falha — sem screenshots para enviar."
  exit 0
fi

echo "[telegram-report] Buscando screenshots de falhas..."

# Playwright salva screenshots em test-results/{test-name}/test-failed-*.png
mapfile -t screenshots < <(find test-results -name "test-failed-*.png" -type f 2>/dev/null | head -10)

if [[ "${#screenshots[@]}" -eq 0 ]]; then
  echo "[telegram-report] Nenhum screenshot encontrado."
  exit 0
fi

echo "[telegram-report] Enviando ${#screenshots[@]} screenshot(s)..."

for screenshot in "${screenshots[@]}"; do
  # Extrair nome legível do caminho (ex: test-results/SMK-03-contratos/test-failed-1.png → SMK-03-contratos)
  test_name=$(basename "$(dirname "$screenshot")" | sed 's/-chromium$//' | sed 's/-/ /g')
  caption="📸 Falha: ${test_name} | \`${SHA_SHORT}\`"

  curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendPhoto" \
    -F "chat_id=${CHAT_ID}" \
    -F "photo=@${screenshot}" \
    -F "caption=${caption}" \
    -F "parse_mode=Markdown" > /dev/null

  sleep 0.1
done

echo "[telegram-report] Concluído — ${#screenshots[@]} screenshot(s) enviados."
