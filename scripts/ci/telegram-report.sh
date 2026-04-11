#!/usr/bin/env bash
# Relatório de testes E2E para Telegram
# Envia resumo detalhado de resultados + todos os screenshots via sendMediaGroup
# Variáveis obrigatórias: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# Variáveis opcionais:   GITHUB_SHA, GITHUB_ACTOR, GITHUB_RUN_URL

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

# ─── Parse detalhado dos JSONs do Playwright ─────────────────────────────────
# Extrai: contadores, suites agrupadas, failures com erro

PARSE_SCRIPT=$(cat <<'PYEOF'
import json, sys, os, re

tiers = {}
all_suites = {}   # suite_title -> count
all_failures = [] # {tier, suite, title, error}
total_passed = total_failed = total_skipped = 0

for tier in [1, 2]:
    path = f"test-results/tier{tier}-results.json"
    if not os.path.exists(path):
        tiers[tier] = {"passed": 0, "failed": 0, "skipped": 0, "ok": False}
        continue
    try:
        d = json.load(open(path))
    except Exception:
        tiers[tier] = {"passed": 0, "failed": 0, "skipped": 0, "ok": False}
        continue

    passed = failed = skipped = 0

    def walk_suites(suites, parent_title=""):
        nonlocal passed, failed, skipped
        for suite in suites:
            suite_title = suite.get("title", "")
            full_title = f"{parent_title} > {suite_title}".strip(" >") if parent_title else suite_title

            walk_suites(suite.get("suites", []), full_title)

            for spec in suite.get("specs", []):
                spec_title = spec.get("title", "")
                tests = spec.get("tests", [])
                if not tests:
                    continue

                suite_key = suite_title or full_title or "Geral"
                if suite_key not in all_suites:
                    all_suites[suite_key] = 0

                for test in tests:
                    status = test.get("status", "")
                    if status == "passed":
                        passed += 1
                        all_suites[suite_key] += 1
                    elif status in ("failed", "timedOut"):
                        failed += 1
                        all_suites[suite_key] += 1
                        error_msg = ""
                        for result in test.get("results", []):
                            err = result.get("error", {})
                            msg = err.get("message", "") if err else ""
                            if msg:
                                clean = re.sub(r'\x1b\[[0-9;]*m', '', msg)
                                lines = [l.strip() for l in clean.splitlines() if l.strip()]
                                error_msg = lines[0][:200] if lines else ""
                                break
                        all_failures.append({
                            "tier": tier,
                            "suite": suite_title,
                            "title": spec_title,
                            "error": error_msg,
                        })
                    elif status == "skipped":
                        skipped += 1

    walk_suites(d.get("suites", []))
    tiers[tier] = {"passed": passed, "failed": failed, "skipped": skipped, "ok": True}
    total_passed += passed
    total_failed += failed
    total_skipped += skipped

output = {
    "total_passed": total_passed,
    "total_failed": total_failed,
    "total_skipped": total_skipped,
    "tiers": tiers,
    "suites": all_suites,
    "failures": all_failures,
}
print(json.dumps(output, ensure_ascii=False))
PYEOF
)

PARSE_RESULT=$(python3 -c "$PARSE_SCRIPT" 2>/dev/null || echo '{"total_passed":0,"total_failed":0,"total_skipped":0,"tiers":{},"suites":{},"failures":[]}')

total_passed=$(echo "$PARSE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['total_passed'])")
total_failed=$(echo "$PARSE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['total_failed'])")
total_skipped=$(echo "$PARSE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['total_skipped'])")

# ─── Status geral ─────────────────────────────────────────────────────────
if [[ "$total_failed" -gt 0 ]]; then
  overall_icon="❌"
  overall_text="FALHOU"
else
  overall_icon="✅"
  overall_text="PASSOU"
fi

# ─── Linhas por tier ──────────────────────────────────────────────────────
tier_lines=$(echo "$PARSE_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
lines = []
for tier in [1, 2]:
    t = d['tiers'].get(str(tier)) or d['tiers'].get(tier)
    if t is None or not t.get('ok'):
        lines.append(f'  ⚠️ Tier {tier}: sem dados')
        continue
    icon = '❌' if t['failed'] > 0 else '✅'
    parts = [f\"{t['passed']} ok\"]
    if t['failed']:  parts.append(f\"{t['failed']} falhas\")
    if t['skipped']: parts.append(f\"{t['skipped']} pulados\")
    lines.append(f\"  {icon} Tier {tier}: {' | '.join(parts)}\")
print('\n'.join(lines))
")

# ─── Lista de suítes ──────────────────────────────────────────────────────
suites_lines=$(echo "$PARSE_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
suites = d.get('suites', {})
if not suites:
    print('  (sem dados de suítes)')
    sys.exit()
lines = []
for name, count in sorted(suites.items(), key=lambda x: -x[1]):
    if name and count > 0:
        lines.append(f'  • {name} ({count} teste(s))')
if len(lines) > 10:
    extra = len(lines) - 10
    lines = lines[:10]
    lines.append(f'  ... e mais {extra} suíte(s)')
print('\n'.join(lines))
")

# ─── Seção de falhas (somente se houver) ──────────────────────────────────
failures_section=""
if [[ "$total_failed" -gt 0 ]]; then
  failures_section=$(echo "$PARSE_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
failures = d.get('failures', [])
if not failures:
    print('')
    sys.exit()
lines = ['\n❌ *Falhas detectadas:*']
for i, f in enumerate(failures[:8], 1):
    suite = f.get('suite', '')
    title = f.get('title', '')
    error = f.get('error', '')
    label = f'{suite} › {title}' if suite else title
    lines.append(f'{i}\\. \`{label[:80]}\`')
    if error:
        lines.append(f'   ↳ {error[:160]}')
if len(failures) > 8:
    lines.append(f'   ... e mais {len(failures)-8} falha(s) — ver Actions')
print('\n'.join(lines))
")
fi

# ─── Montar mensagem principal ────────────────────────────────────────────
MSG="🧪 *Testes E2E — ${overall_icon} ${overall_text}*

Commit: \`${SHA_SHORT}\` por ${ACTOR}
📊 *Total:* ${total_passed} ok | ${total_failed} falhas | ${total_skipped} pulados

*Por tier:*
${tier_lines}

📋 *Suítes executadas:*
${suites_lines}${failures_section}"

if [[ -n "$RUN_URL" ]]; then
  MSG+="

🔍 [Ver detalhes no GitHub Actions](${RUN_URL})"
fi

# ─── Enviar mensagem de resumo ─────────────────────────────────────────────
echo "[telegram-report] Enviando resumo..."
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{
    \"chat_id\": \"${CHAT_ID}\",
    \"text\": $(echo "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    \"parse_mode\": \"Markdown\",
    \"disable_web_page_preview\": true
  }" > /dev/null

# ─── Coletar TODOS os screenshots (passou e falhou) ────────────────────────
echo "[telegram-report] Coletando screenshots..."

# Com screenshot:'on', Playwright gera:
#   test-results/{dir}/test-1.png         (passou)
#   test-results/{dir}/test-failed-1.png  (falhou)
# Coletamos todos os PNGs, exceto diretórios de setup de auth
mapfile -t all_screenshots < <(
  find test-results -name "*.png" -type f \
    ! -path "*/auth.setup*" \
    2>/dev/null \
  | sort \
  | head -50
)

if [[ "${#all_screenshots[@]}" -eq 0 ]]; then
  echo "[telegram-report] Nenhum screenshot encontrado."
  exit 0
fi

echo "[telegram-report] Total de screenshots: ${#all_screenshots[@]}"

# ─── Enviar em lotes de 10 via sendMediaGroup ─────────────────────────────
# sendMediaGroup aceita até 10 itens por requisição
BATCH_SIZE=10
total_screenshots=${#all_screenshots[@]}
sent_total=0
batch_num=0

for (( i=0; i<total_screenshots; i+=BATCH_SIZE )); do
  batch_num=$((batch_num + 1))
  batch=("${all_screenshots[@]:i:BATCH_SIZE}")

  echo "[telegram-report] Enviando lote ${batch_num} (${#batch[@]} screenshots)..."

  # Montar JSON do media array e os -F de cada arquivo
  media_json="["
  curl_files=()
  for j in "${!batch[@]}"; do
    shot="${batch[$j]}"
    attach_name="photo${j}"

    # Caption apenas no primeiro item do lote (Telegram mostra no álbum)
    if [[ $j -eq 0 ]]; then
      # Extrair nome legível do diretório
      dir_name=$(basename "$(dirname "$shot")" \
        | sed 's/-chromium$//' \
        | sed 's/-no-auth$//' \
        | sed 's/-[0-9a-f]\{8\}-.*$//' \
        | tr '-' ' ')
      is_failure="false"
      [[ "$shot" == *"test-failed"* ]] && is_failure="true"
      if [[ "$is_failure" == "true" ]]; then
        icon="❌"
      else
        icon="✅"
      fi
      caption="${icon} Lote ${batch_num}/${batch_num} | \`${SHA_SHORT}\`"
      # Escapar aspas para JSON
      caption_escaped=$(echo "$caption" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])')
      media_json+="{\"type\":\"photo\",\"media\":\"attach://${attach_name}\",\"caption\":\"${caption_escaped}\",\"parse_mode\":\"Markdown\"}"
    else
      # Sem caption nos demais — apenas icon no nome do attach
      is_failure="false"
      [[ "$shot" == *"test-failed"* ]] && is_failure="true"
      media_json+=",{\"type\":\"photo\",\"media\":\"attach://${attach_name}\"}"
    fi

    curl_files+=(-F "${attach_name}=@${shot}")
  done
  media_json+="]"

  curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMediaGroup" \
    -F "chat_id=${CHAT_ID}" \
    -F "media=${media_json}" \
    "${curl_files[@]}" > /dev/null

  sent_total=$((sent_total + ${#batch[@]}))
  sleep 0.5
done

echo "[telegram-report] Concluído — ${sent_total} screenshot(s) enviados em ${batch_num} lote(s)."
