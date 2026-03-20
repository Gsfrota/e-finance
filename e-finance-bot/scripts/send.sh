#!/usr/bin/env bash
# send.sh — envia mensagem WhatsApp via UazAPI
# Uso: ./send.sh <numero> <mensagem>
# Ex:  ./send.sh 558591318582 "oi tudo bem?"

set -euo pipefail

UAZAPI_URL="${UAZAPI_SERVER_URL:-https://processai.uazapi.com}"
TOKEN="${UAZAPI_INSTANCE_TOKEN:?Defina UAZAPI_INSTANCE_TOKEN}"

NUMERO="${1:?Uso: $0 <numero> <mensagem>}"
MENSAGEM="${2:?Uso: $0 <numero> <mensagem>}"

curl -s -X POST "$UAZAPI_URL/send/text" \
  -H "token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"number\":\"$NUMERO\",\"text\":\"$MENSAGEM\"}" | python3 -m json.tool 2>/dev/null || true
