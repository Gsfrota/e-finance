#!/usr/bin/env bash
# Relatório de testes E2E para Telegram
# Envia resumo detalhado de resultados + screenshots de falhas com captions ricos
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
# Extrai: contadores, suites agrupadas, failures com erro e diretório de screenshot

PARSE_SCRIPT=$(cat <<'PYEOF'
import json, sys, os, re

tiers = {}
all_suites = {}   # suite_title -> count
all_failures = [] # {tier, suite, title, error, screenshot_dir}
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

            # Walk nested suites
            walk_suites(suite.get("suites", []), full_title)

            # Walk specs in this suite
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
                        # Extrair mensagem de erro
                        error_msg = ""
                        for result in test.get("results", []):
                            err = result.get("error", {})
                            msg = err.get("message", "") if err else ""
                            if msg:
                                # Limpa ANSI e pega primeira linha não-vazia
                                clean = re.sub(r'\x1b\[[0-9;]*m', '', msg)
                                lines = [l.strip() for l in clean.splitlines() if l.strip()]
                                error_msg = lines[0][:200] if lines else ""
                                break

                        # Montar diretório esperado do screenshot
                        # Playwright gera: test-results/{suite}-{spec}-{project}/test-failed-N.png
                        # Simplificamos: guardamos suite e spec para busca posterior
                        all_failures.append({
                            "tier": tier,
                            "suite": suite_title,
                            "title": spec_title,
                            "error": error_msg,
                            "screenshot_dir": "",  # preenchido depois
                        })
                    elif status == "skipped":
                        skipped += 1

    walk_suites(d.get("suites", []))

    tiers[tier] = {"passed": passed, "failed": failed, "skipped": skipped, "ok": True}
    total_passed += passed
    total_failed += failed
    total_skipped += skipped

# Buscar screenshots para cada falha
for fail in all_failures:
    # Procura screenshot em qualquer subdiretório de test-results
    found = ""
    search_term = re.sub(r'[^a-zA-Z0-9]', '-', fail["title"])[:30].lower()
    for root, dirs, files in os.walk("test-results"):
        for f in files:
            if f.startswith("test-failed") and f.endswith(".png"):
                dir_lower = root.lower()
                if search_term[:10] in dir_lower or fail["suite"][:8].lower() in dir_lower:
                    found = os.path.join(root, f)
                    break
        if found:
            break
    # Fallback: primeiro screenshot disponível
    if not found:
        for root, dirs, files in os.walk("test-results"):
            for f in files:
                if f.startswith("test-failed") and f.endswith(".png"):
                    found = os.path.join(root, f)
                    break
            if found:
                break
    fail["screenshot_dir"] = found

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
    if t is None:
        lines.append(f'  ⚠️ Tier {tier}: sem dados')
        continue
    if not t.get('ok'):
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
# Limitar a 10 suítes para não explodir a mensagem
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

# ─── Screenshots de falhas com captions ricos ─────────────────────────────
if [[ "$total_failed" -eq 0 ]]; then
  echo "[telegram-report] Nenhuma falha — relatório concluído."
  exit 0
fi

echo "[telegram-report] Buscando screenshots de falhas..."

# Extrair lista de {screenshot_path}|{suite}|{title}|{error} das falhas com screenshot
FAILURE_PHOTOS=$(echo "$PARSE_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
failures = d.get('failures', [])
for f in failures:
    shot = f.get('screenshot_dir', '')
    if shot:
        suite = f.get('suite', '').replace('|', ' ')
        title = f.get('title', '').replace('|', ' ')
        error = f.get('error', '').replace('|', ' ').replace('\n', ' ')
        print(f\"{shot}|{suite}|{title}|{error}\")
")

# Fallback: encontrar screenshots não mapeados
if [[ -z "$FAILURE_PHOTOS" ]]; then
  echo "[telegram-report] Usando fallback de busca de screenshots..."
  mapfile -t fallback_shots < <(find test-results -name "test-failed-*.png" -type f 2>/dev/null | head -8)
  for shot in "${fallback_shots[@]}"; do
    dir_name=$(basename "$(dirname "$shot")" | sed 's/-chromium$//' | sed 's/-/ /g')
    FAILURE_PHOTOS+="${shot}|Falha|${dir_name}|
"
  done
fi

if [[ -z "$FAILURE_PHOTOS" ]]; then
  echo "[telegram-report] Nenhum screenshot encontrado."
  exit 0
fi

sent=0
while IFS='|' read -r screenshot suite title error; do
  [[ -z "$screenshot" || ! -f "$screenshot" ]] && continue
  [[ $sent -ge 8 ]] && break

  # Montar caption rico (limite 1024 chars)
  caption="❌ ${title:0:60}"
  if [[ -n "$suite" ]]; then
    caption+="
📁 ${suite:0:50}"
  fi
  if [[ -n "$error" ]]; then
    caption+="
💬 ${error:0:200}"
  fi
  caption+="
🔗 ${SHA_SHORT}"

  echo "[telegram-report] Enviando screenshot: ${title:0:50}..."
  curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendPhoto" \
    -F "chat_id=${CHAT_ID}" \
    -F "photo=@${screenshot}" \
    -F "caption=${caption}" \
    -F "parse_mode=Markdown" > /dev/null

  sent=$((sent + 1))
  sleep 0.3
done <<< "$FAILURE_PHOTOS"

echo "[telegram-report] Concluído — ${sent} screenshot(s) enviados."
