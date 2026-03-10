#!/usr/bin/env bash
# send.sh — envia mensagem WhatsApp via UazAPI
# Uso: ./send.sh <numero> <mensagem>
# Ex:  ./send.sh 558591318582 "oi tudo bem?"

set -euo pipefail

UAZAPI_URL="https://processai.uazapi.com"
TOKEN="360088d2-12bf-420b-a4fa-121210dd03c1"

NUMERO="${1:?Uso: $0 <numero> <mensagem>}"
MENSAGEM="${2:?Uso: $0 <numero> <mensagem>}"

curl -s -X POST "$UAZAPI_URL/send/text" \
  -H "token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$NUMERO\",\"text\":\"$MENSAGEM\"}" | python3 -m json.tool 2>/dev/null || true
