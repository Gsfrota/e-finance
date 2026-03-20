# DEPLOY.md — Runbook de Deploy do Bot

Fluxo oficial de deploy do `e-finance-bot` para o Google Cloud Run.

---

## Instâncias UazAPI

| Instância | Número | Token | Papel |
|-----------|--------|-------|-------|
| **Salomão** (bot produtivo) | `558520284195` | `360088d2-12bf-420b-a4fa-121210dd03c1` | Alvo dos testes — recebe e responde |
| **Guilherme** (instância de teste) | `558591318582` | `9f7f852a-c679-44f6-9e78-3db03a59c1f4` | Arma de teste — envia mensagens reais ao Salomão |

> A instância Guilherme é a **arma**: dispara mensagens reais via WhatsApp para o Salomão. Use-a nos testes pós-deploy para validar o bot em produção com tráfego real.

---

## Fluxo completo de deploy

```
[Fase 0] Testes unitários
[Fase 1] Build TypeScript
[Fase 2] Smoke test pré-deploy (payload sintético)
[Fase 3] Deploy → Cloud Run via deploy-bot.sh
[Fase 4] Health check pós-deploy
[Fase 5] Verificar webhook UazAPI (eventos explícitos)
[Fase 6] Smoke test pós-deploy (mensagem real via Guilherme → Salomão)
[Fase 7] Rollback (se necessário)
```

---

## Fase 0 — Testes unitários

```bash
cd e-finance-bot
npm test
```

Todos os testes devem passar antes de continuar. Em caso de falha, corrigir antes do deploy.

---

## Fase 1 — Build TypeScript

```bash
npm run build
```

Zero erros de compilação obrigatório.

---

## Fase 2 — Smoke test pré-deploy

Testa o bot rodando **localmente** ou na **versão atual em produção** com payloads sintéticos (sem passar pelo UazAPI). Útil para validar que as mudanças não quebraram nada antes de deployar.

```bash
# Teste na versão de produção atual
./scripts/smoke-test.sh --pre-deploy

# Teste num servidor local (npm run dev)
BOT_URL=http://localhost:8080 ./scripts/smoke-test.sh --pre-deploy
```

O script testa: health, ajuda, cobranças de hoje, recebíveis, criação de contrato e dashboard.

---

## Fase 3 — Deploy

```bash
./deploy-bot.sh
```

O script faz automaticamente:
1. `npm ci` — instala dependências
2. `npm test` — testes unitários
3. `npm run build` — TypeScript check
4. Docker build + push para Artifact Registry
5. Cloud Run deploy (`e-finance-bot`, região `us-west1`)
6. Registra webhook via `/setup` endpoint
7. Atualiza Cloud Scheduler job `morning-briefing`

Para pular os testes (quando já rodou nas fases 0-1):
```bash
./deploy-bot.sh --skip-tests
```

---

## Fase 4 — Health check pós-deploy

```bash
URL=$(gcloud run services describe e-finance-bot \
  --region=us-west1 \
  --project=tribal-pillar-476701-a3 \
  --format="value(status.url)")

curl -s "$URL/health"
# Esperado: {"status":"healthy"}
```

---

## Fase 5 — Verificar webhook UazAPI

O `/setup` do bot registra a URL mas às vezes sem os eventos explícitos. Verificar:

```bash
curl -s https://processai.uazapi.com/webhook \
  -H "token: 360088d2-12bf-420b-a4fa-121210dd03c1"
```

Se o campo `events` estiver vazio (`[]`), registrar manualmente:

```bash
curl -s -X POST https://processai.uazapi.com/webhook \
  -H "Content-Type: application/json" \
  -H "token: 360088d2-12bf-420b-a4fa-121210dd03c1" \
  -d '{
    "url": "'"$URL"'/webhook/whatsapp",
    "enabled": true,
    "addUrlEvents": false,
    "addUrlTypesMessages": false,
    "events": ["messages","messages_update","connection","contacts","presence"],
    "excludeMessages": []
  }'
```

---

## Fase 6 — Smoke test pós-deploy (mensagem real)

Usa a instância **Guilherme** para disparar mensagens reais ao **Salomão** e validar que o bot responde corretamente em produção.

```bash
./scripts/smoke-test.sh --post-deploy
```

O script:
1. Usa `scripts/send.sh` com o token da instância Guilherme
2. Envia mensagens reais para o número do Salomão (`558520284195`)
3. Aguarda 8s para o bot processar e responder
4. Verifica nos logs do Cloud Run que as mensagens foram processadas
5. Reporta PASS/FAIL para cada cenário

> **Atenção**: As mensagens chegam no WhatsApp real do Salomão. Use apenas mensagens de teste inofensivas.

Para verificar os logs durante o teste:

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=e-finance-bot" \
  --limit=20 --format="json" \
  --project=tribal-pillar-476701-a3 --freshness=5m \
  | python3 -c "
import json,sys
logs=json.load(sys.stdin)
for e in logs:
  p = e.get('jsonPayload', e.get('textPayload',''))
  if p:
    ts = e.get('timestamp','')[11:19]
    print(f'{ts} | {p}')
"
```

---

## Fase 7 — Rollback

Se algo der errado após o deploy, reverter para a versão anterior:

```bash
# Listar revisões recentes
gcloud run revisions list \
  --service=e-finance-bot \
  --region=us-west1 \
  --project=tribal-pillar-476701-a3 \
  --limit=5

# Redirecionar 100% do tráfego para a revisão anterior
gcloud run services update-traffic e-finance-bot \
  --region=us-west1 \
  --project=tribal-pillar-476701-a3 \
  --to-revisions=<REVISAO_ANTERIOR>=100
```

---

## Referências

- [`instancia.md`](./instancia.md) — tokens e números das instâncias UazAPI
- [`docs/CONFIGURACAO.md`](./docs/CONFIGURACAO.md) — configuração completa e troubleshooting
- [`deploy-bot.sh`](./deploy-bot.sh) — script de deploy automatizado
- [`scripts/smoke-test.sh`](./scripts/smoke-test.sh) — smoke tests pré e pós-deploy
- [`scripts/send.sh`](./scripts/send.sh) — envio manual de mensagens via UazAPI
- [`scripts/test-bot.sh`](./scripts/test-bot.sh) — simulação de webhook payload
