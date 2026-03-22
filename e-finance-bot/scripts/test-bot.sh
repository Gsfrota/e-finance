#!/usr/bin/env bash
# test-bot.sh — simula mensagem recebida pelo bot (para testes)
# Uso: ./test-bot.sh <mensagem>
# Ex:  ./test-bot.sh "quem eu cobro hoje?"

set -euo pipefail

BOT_URL="${BOT_URL:-https://e-finance-bot-oh6s7bvufq-uw.a.run.app}"
SENDER="${TEST_SENDER:-5500000000000@s.whatsapp.net}"
OWNER="${OWNER_NUMBER:-5500000000001}"
WHATSAPP_WEBHOOK_SECRET="${UAZAPI_WEBHOOK_SECRET:-}"
MENSAGEM="${1:?Uso: $0 <mensagem>}"
MSG_ID="TEST-$(date +%s%N | cut -c1-16)"

if [[ -z "$WHATSAPP_WEBHOOK_SECRET" ]]; then
  echo "Falta UAZAPI_WEBHOOK_SECRET no ambiente"
  exit 1
fi

curl -s -X POST "$BOT_URL/webhook/whatsapp/${WHATSAPP_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -H "x-uazapi-webhook-secret: ${WHATSAPP_WEBHOOK_SECRET}" \
  -d "{
    \"chatid\": \"$SENDER\",
    \"text\": \"$MENSAGEM\",
    \"messageType\": \"extendedTextMessage\",
    \"sender\": \"$SENDER\",
    \"senderName\": \"Guilherme\",
    \"fromMe\": false,
    \"messageTimestamp\": $(date +%s),
    \"messageid\": \"$MSG_ID\",
    \"owner\": \"$OWNER\",
    \"isGroup\": false
  }"
echo ""
