#!/usr/bin/env bash
# test-bot.sh — simula mensagem recebida pelo bot (para testes)
# Uso: ./test-bot.sh <mensagem>
# Ex:  ./test-bot.sh "quem eu cobro hoje?"

set -euo pipefail

BOT_URL="https://e-finance-bot-oh6s7bvufq-uw.a.run.app"
SENDER="558591318582@s.whatsapp.net"
OWNER="558520284195"
MENSAGEM="${1:?Uso: $0 <mensagem>}"
MSG_ID="TEST-$(date +%s%N | cut -c1-16)"

curl -s -X POST "$BOT_URL/webhook/whatsapp" \
  -H "Content-Type: application/json" \
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
