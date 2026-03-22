# Deploy Runbook — E-Finance (Cloud Run)

**Executor:** Agente Gage (@devops)
**Serviço:** `e-finance` | Projeto: `tribal-pillar-476701-a3` | Região: `us-west1`
**Registry:** `us-west1-docker.pkg.dev/tribal-pillar-476701-a3/cloud-run-source-deploy/e-finance`

> Este runbook substitui a execução "cega" do `deploy.sh`. Execute cada fase em sequência.
> Gates marcados com **🔴 BLOQUEANTE** abortam o deploy se falharem.
> Gates marcados com **🟡 WARN** registram o aviso mas não bloqueam.

---

## Compatibilidade atual

O app já foi adaptado para o modelo novo, mas a operação ainda convive com nomes legados em alguns pontos:

- Frontend: `SUPABASE_ANON_KEY` é o nome oficial no browser.
- Frontend legado: `SUPABASE_KEY` ainda funciona como fallback enquanto a migração não termina.
- Bot: `SETUP_SECRET`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` e `UAZAPI_WEBHOOK_SECRET` passaram a ser obrigatórios no serviço.
- Banco: perfis migrados podem ter `auth_user_id` diferente de `id`, então a validação de fluxo precisa considerar os dois campos.
- Banco enterprise: o app novo assume `company_id` nas tabelas operacionais quando a migração V28 já foi aplicada e o backfill foi validado.

Se houver dúvida sobre o que é novo versus legado, use `docs/guides/operational-differences.md` como referência.

## Rollout V28 — Multiempresa Enterprise

Execute esta trilha antes do deploy do app quando o rollout envolver trial multiempresa ou tenant `empresarial`.

1. Pedir ao Claude guardião para inspecionar o schema real e comparar com [context/migration_v28_multi_company.sql](../../context/migration_v28_multi_company.sql).
2. Só aplicar a migration se o Claude concordar explicitamente que não há blockers.
3. Aplicar a migration via Claude/MCP.
4. Validar backfill:

```sql
select tenant_id, count(*) filter (where company_id is null) as profiles_sem_company
from public.profiles
group by tenant_id;

select tenant_id, count(*) filter (where company_id is null) as investments_sem_company
from public.investments
group by tenant_id;

select tenant_id, count(*) filter (where company_id is null) as installments_sem_company
from public.loan_installments
group by tenant_id;
```

5. Confirmar que cada tenant tem uma empresa primária:

```sql
select tenant_id, count(*) filter (where is_primary) as primarias
from public.companies
group by tenant_id;
```

6. Fazer smoke com um admin em trial ativo ou enterprise ativo:
   - login
   - `Todas as empresas`
   - trocar empresa no switcher
   - `Users`
   - `Contracts`
   - `Top Clientes`
7. Fazer smoke com um admin sem entitlement:
   - switcher visível e bloqueado
   - CTA para `Assinatura`
   - company primária continua operável
8. Só depois considerar endurecer `NOT NULL` em `company_id`.

## Variáveis de ambiente locais (setar no início)

```bash
PROJECT="tribal-pillar-476701-a3"
REGION="us-west1"
SERVICE="e-finance"
IMAGE="us-west1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"
TAG=$(date +%Y%m%d-%H%M%S)
FULL_IMAGE="${IMAGE}:${TAG}"
```

---

## Fase 0 — Pre-flight

Verificar pré-requisitos e capturar estado atual **antes** de qualquer mudança.

### 0a. Ferramentas instaladas

```bash
command -v docker  || echo "MISSING: docker"
command -v gcloud  || echo "MISSING: gcloud"
command -v node    || echo "MISSING: node"
```

**🔴 BLOQUEANTE:** qualquer `MISSING` aborta.

### 0b. Projeto GCP ativo

```bash
gcloud auth list
gcloud config get-value project
```

Confirmar que o projeto ativo é `tribal-pillar-476701-a3`.
Se não: `gcloud config set project tribal-pillar-476701-a3`

**🔴 BLOQUEANTE:** projeto errado pode deployar no lugar errado.

### 0c. Capturar PREV_REVISION (necessário para rollback)

```bash
PREV_REVISION=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.latestReadyRevisionName)" 2>/dev/null || echo "NONE")
echo "PREV_REVISION: ${PREV_REVISION}"
```

> Salvar este valor. O estado do gcloud após uma falha pode ser inconsistente —
> capturar agora garante que o rollback funcione mesmo em cenários degradados.

### 0d. Estado do repositório

```bash
git status --short
git log --oneline -1
```

Revisar se há arquivos não commitados relevantes. Não bloqueia, mas deve ser conscientemente avaliado.

---

## Fase 1 — Security Gate *(novo — não existe no deploy.sh)*

### 1a. Secret scan no diff

```bash
if git diff HEAD~1 HEAD | grep -iE '(password|secret|api_key|token|private_key)\s*[:=]\s*["\x27][^"\x27]{8,}'; then
  echo "SECRET_FOUND — possível credencial no diff"
else
  echo "OK — nenhum padrão suspeito encontrado"
fi
```

**🔴 BLOQUEANTE se `SECRET_FOUND`:** revisar o diff antes de continuar.

> O scan é feito no diff (não na working tree) para evitar falsos positivos de
> `.env.example`, fixtures de teste e arquivos de template com placeholders.

### 1b. Verificar entradas críticas no .dockerignore

```bash
for entry in ".env" ".git" "e-finance-bot" ".aios-core"; do
  if grep -q "^${entry}" .dockerignore; then
    echo "OK: ${entry} presente"
  else
    echo "MISSING: ${entry} ausente do .dockerignore"
  fi
done
```

**🔴 BLOQUEANTE se qualquer `MISSING`:** imagem pode vazar secrets ou código desnecessário.

### 1c. Trivy scan (graceful skip)

```bash
if command -v trivy >/dev/null 2>&1; then
  echo "Rodando Trivy na imagem base antes do build..."
  trivy image --severity HIGH,CRITICAL nginx:alpine 2>/dev/null \
    || echo "TRIVY_WARN — vulnerabilidades encontradas (não bloqueante pré-build)"
else
  echo "TRIVY_SKIP — trivy não instalado, pulando scan de CVE"
fi
```

**🟡 WARN:** CVEs em imagem base não bloqueam (maioria são low-severity da distro).
O scan pós-build na Fase 3 é o gate definitivo.

---

## Fase 2 — QA Gate

### 2a. TypeScript check

```bash
npx tsc --noEmit
```

**🔴 BLOQUEANTE:** qualquer erro TS aborta. Erros de tipo em prod são inaceitáveis.

### 2b. Vite build local *(novo — antes do Docker)*

```bash
npm run build
test -f dist/index.html && echo "OK: dist/index.html gerado" || echo "FAIL: dist/index.html ausente"
```

**🔴 BLOQUEANTE:** detecta erros Vite em ~30s em vez de esperar o build Docker completo (~5min).
Limpar `dist/` após: `rm -rf dist/`

### 2c. Análise de diff + auditoria de inputs

```bash
ANALYSIS=$(npx tsx scripts/qa/analyze-diff.ts)
INPUT_AUDIT=$(echo "$ANALYSIS" | npx tsx scripts/qa/audit-inputs.ts)
INPUT_STATUS=$(echo "$INPUT_AUDIT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.skip ? 'skip' : d.hasBlockingGaps ? 'blocked' : 'ok');
")
echo "Input audit: ${INPUT_STATUS}"
```

**🔴 BLOQUEANTE se `blocked`:** gaps de validação detectados em inputs alterados.

### 2d. Testes E2E (skip gracioso)

```bash
if [ -z "${TEST_ADMIN_EMAIL:-}" ] || [ -z "${TEST_ADMIN_PASSWORD:-}" ]; then
  echo "E2E_SKIP — TEST_ADMIN_EMAIL não configurado, pulando Playwright"
else
  npx playwright test
fi
```

**🟡 WARN se skip:** documentar que E2E não foi executado no Post-Deploy Summary.

### 2e. Gate multiempresa enterprise

Executar quando o rollout envolver um tenant `empresarial`.

```sql
select tenant_id, count(*) filter (where company_id is null) as profiles_sem_company
from public.profiles
group by tenant_id;

select tenant_id, count(*) filter (where company_id is null) as investments_sem_company
from public.investments
group by tenant_id;

select tenant_id, count(*) filter (where company_id is null) as installments_sem_company
from public.loan_installments
group by tenant_id;
```

**🔴 BLOQUEANTE:** qualquer registro operacional ainda sem `company_id`.

Smoke mínimo:
- login com admin enterprise;
- validar switcher no topo;
- `Todas as empresas` em `HOME`;
- troca para uma company específica;
- abrir `USERS`, `CONTRACTS` e `SETTINGS > Empresa`;
- confirmar que o consolidado bate com a soma das companies relevantes.

---

## Fase 3 — Build Docker

### CHECKPOINT 3 — Aguardar confirmação antes do build

Exibir resumo para confirmação:

```
Branch:     $(git branch --show-current)
Commit:     $(git log --oneline -1)
Tag:        ${TAG}
Image URI:  ${FULL_IMAGE}
```

**Aguardar aprovação explícita antes de prosseguir.**

### 3a. Autenticar Docker no Artifact Registry

```bash
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
```

### 3b. Build da imagem

```bash
docker build \
  --tag "${FULL_IMAGE}" \
  --tag "${IMAGE}:latest" \
  .
```

> Nota: `GEMINI_API_KEY` é injetado como `build-arg` no workflow CI (`deploy.yml`).
> No deploy local, a variável deve estar disponível via `--build-arg GEMINI_API_KEY=${GEMINI_API_KEY:-}`.
> Se não configurada, o build continua (feature degraded).

### 3c. Trivy pós-build (warn, não bloqueia)

```bash
if command -v trivy >/dev/null 2>&1; then
  trivy image --exit-code 0 --severity HIGH,CRITICAL "${FULL_IMAGE}" \
    || echo "TRIVY_WARN — CVEs encontradas na imagem final (revisar se crítico)"
fi
```

**🟡 WARN:** `--exit-code 0` garante que CVEs em imagem base não bloqueiem feature deploys.

---

## Fase 4 — Push para Artifact Registry

### CHECKPOINT 4 — Confirmar URI antes do push

```
URI: ${FULL_IMAGE}
```

**Aguardar confirmação.**

### 4a. Push

```bash
docker push "${FULL_IMAGE}"
docker push "${IMAGE}:latest"
```

**🔴 BLOQUEANTE se falhar:** não deployar uma imagem não confirmada no registry.
A imagem permanece no cache local — retry de push sem rebuild.

---

## Fase 5 — Deploy Cloud Run

### CHECKPOINT 5 — OPERAÇÃO IRREVERSÍVEL

```
Revisão atual (para rollback): ${PREV_REVISION}
Nova imagem:                   ${FULL_IMAGE}
Serviço:                       ${SERVICE} @ ${REGION}
```

**⚠️ Esta é a operação de maior impacto. Confirmar PREV_REVISION antes de prosseguir.**

### 5a. Deploy

```bash
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
```

> Observação operacional: este comando ainda carrega o nome legado `SUPABASE_KEY` porque os scripts da base estão em transição. O código do frontend já entende `SUPABASE_ANON_KEY` no runtime; a migração de nomes deve ser tratada como mudança separada do deploy.

### 5b. Capturar NEW_REVISION e SERVICE_URL

```bash
SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.url)")

NEW_REVISION=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.latestReadyRevisionName)")

echo "NEW_REVISION: ${NEW_REVISION}"
echo "SERVICE_URL:  ${SERVICE_URL}"
```

**🔴 Se deploy falhar → ir direto para Fase 7 (Rollback).**

---

## Fase 6 — Health Check *(aprimorado)*

### 6a. Polling HTTP

```bash
MAX_ATTEMPTS=8
DELAY=5
ATTEMPT=0
HTTP_STATUS=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${SERVICE_URL}" 2>/dev/null || echo "000")
  if [ "${HTTP_STATUS}" = "200" ]; then
    echo "OK: HTTP ${HTTP_STATUS} após $((ATTEMPT * DELAY))s"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  echo "Aguardando... (${ATTEMPT}/${MAX_ATTEMPTS}) HTTP ${HTTP_STATUS}"
  sleep ${DELAY}
done

[ "${HTTP_STATUS}" != "200" ] && echo "HEALTH_FAIL" || echo "HEALTH_OK"
```

### 6b. Verificar injeção de secrets *(novo — gate crítico)*

```bash
ENV_CHECK=$(curl -s --max-time 10 "${SERVICE_URL}/env-config.js" 2>/dev/null)
if echo "${ENV_CHECK}" | grep -q 'window._env_'; then
  echo "ENV_CONFIG_OK — secrets injetados pelo entrypoint"
else
  echo "ENV_CONFIG_FAIL — env-config.js ausente ou malformado"
  echo "Conteúdo recebido: ${ENV_CHECK}"
fi
```

> **Por que este check existe:** `docker-entrypoint.sh` gera `env-config.js` com
> `SUPABASE_URL` e `SUPABASE_KEY` em runtime. Se o entrypoint falhou silenciosamente,
> nginx serve HTTP 200 mas com credenciais vazias — a app abre mas não carrega dados.
> Este gate detecta essa falha silenciosa que `deploy.sh` não detectava.

> Para a fase atual da migração, considerar também o nome novo `SUPABASE_ANON_KEY` ao revisar configs ou templates de runtime.

**🔴 BLOQUEANTE se `HEALTH_FAIL` OU `ENV_CONFIG_FAIL` → Fase 7 (Rollback).**

---

## Fase 7 — Rollback

> Executar esta fase se qualquer gate da Fase 5 ou 6 falhar.

### 7a. Reverter tráfego para revisão anterior

```bash
echo "Iniciando rollback para: ${PREV_REVISION}"
gcloud run services update-traffic "${SERVICE}" \
  --to-revisions="${PREV_REVISION}=100" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

### 7b. Verificar health pós-rollback

```bash
ROLLBACK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${SERVICE_URL}" 2>/dev/null || echo "000")
echo "Health pós-rollback: HTTP ${ROLLBACK_STATUS}"
```

### 7c. Buscar logs da falha

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --limit=20 --format="json" \
  --project="${PROJECT}" --freshness=10m \
  | python3 -c "
import json, sys
logs = json.load(sys.stdin)
for e in logs:
  p = e.get('jsonPayload', e.get('textPayload', ''))
  ts = e.get('timestamp', '')[11:19]
  if p:
    print(f'{ts} | {p}')
"
```

### 7d. Se rollback falhar — CRITICAL ESCALATION

```
❌ CRITICAL: rollback também falhou.
   Console GCP Cloud Run:
   https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/revisions?project=${PROJECT}

   Ações manuais:
   1. No console, selecionar uma revisão saudável conhecida
   2. Usar "Gerenciar tráfego" → enviar 100% para essa revisão
   3. Abrir incident se serviço estiver down
```

---

## Fase 8 — Post-Deploy Summary

```
═══════════════════════════════════════════════════════
  DEPLOY SUMMARY
═══════════════════════════════════════════════════════
  Data:          $(date '+%Y-%m-%d %H:%M:%S')
  Branch:        $(git branch --show-current)
  Commit:        $(git log --oneline -1)
  Image Tag:     ${TAG}
  New Revision:  ${NEW_REVISION}
  Prev Revision: ${PREV_REVISION}
  Service URL:   ${SERVICE_URL}
─────────────────────────────────────────────────────
  Health HTTP:   OK (200)
  Env Config:    ENV_CONFIG_OK
─────────────────────────────────────────────────────
  Security Gates
    1a Secret scan:    OK / SKIPPED
    1b .dockerignore:  OK
    1c Trivy pre:      OK / TRIVY_SKIP
  QA Gates
    2a TypeScript:     OK
    2b Vite build:     OK
    2c Input audit:    OK / skip
    2d E2E:            OK / E2E_SKIP
═══════════════════════════════════════════════════════
```

### 8a. Tag git opcional

```bash
git tag "deploy-${TAG}" HEAD
echo "Tag criada: deploy-${TAG}"
```

---

## Decisões de design

| Decisão | Razão |
|---|---|
| `npm run build` na Fase 2 (antes do Docker) | Detecta erros Vite em ~30s vs ~5min de build Docker |
| Trivy `--exit-code 0` pós-build | CVEs em imagem base não devem bloquear feature deploys |
| Verificar `env-config.js` no health check | nginx retorna 200 mesmo se entrypoint falhou — garante secrets injetados |
| `PREV_REVISION` capturado na Fase 0 | Estado do gcloud pós-falha pode ser inconsistente |
| Secret scan no diff (não na working tree) | Evita falsos positivos de `.env.example` e fixtures |
| Checkpoints explícitos antes de push/deploy | Operações irreversíveis requerem confirmação consciente |

---

## Referências

| Arquivo | Relevância |
|---|---|
| `deploy.sh` | Script original (flags gcloud, registry path, health check) |
| `scripts/pre-deploy-qa.sh` | Lógica QA completa com skip gracioso E2E |
| `docker-entrypoint.sh` | Gera `env-config.js` com secrets em runtime |
| `.dockerignore` | Entradas validadas na Fase 1b |
| `.github/workflows/deploy.yml` | Referência para `GEMINI_API_KEY` como build-arg |
| `e-finance-bot/docs/CONFIGURACAO.md` | Runbook do bot (deploy separado via `deploy-bot.sh`) |
| `docs/guides/operational-differences.md` | Diferença entre legado e comportamento atual |
