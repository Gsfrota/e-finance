# e-finance-bot — Guia de Configuração e Operação

## Visão Geral

O `e-finance-bot` é um bot de WhatsApp + Telegram que funciona como assistente financeiro para devedores e investidores da plataforma e-finance. Roda no **Google Cloud Run** (`us-west1`) e recebe mensagens via webhooks.

---

## Arquitetura

```
Cloud Scheduler (*/5 min)
    └── POST /scheduler/morning-briefing

WhatsApp (UazAPI)          Telegram (Bot API)
    └── POST /webhook/whatsapp/:secret?    └── POST /webhook/telegram
            │                               │
            └──────────────┬────────────────┘
                           │
                    src/index.ts
                    (Express + InboundBuffer)
                           │
                    src/bot/conversation.ts
                    (Processamento de mensagens)
                           │
                    Supabase (banco de dados)
                    Gemini (AI)
```

---

## Variáveis de Ambiente (Secrets)

Todos os secrets são armazenados no **Google Secret Manager** e injetados pelo Cloud Run como variáveis de ambiente.

| Variável | Secret Manager | Descrição |
|----------|---------------|-----------|
| `UAZAPI_INSTANCE_TOKEN` | `UAZAPI_INSTANCE_TOKEN` | Token da instância WA na UazAPI |
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | Token do bot Telegram |
| `SETUP_SECRET` | `SETUP_SECRET` | Secret do endpoint `/setup` |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Secret do webhook Telegram |
| `UAZAPI_WEBHOOK_SECRET` | `UAZAPI_WEBHOOK_SECRET` | Secret embutido na URL do webhook WhatsApp |
| `SUPABASE_URL` | `SUPABASE_URL_EFINANCE` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY_EFINANCE` | Chave service role Supabase |
| `GEMINI_API_KEY` | `GEMINI_API_KEY_EFINANCE` | Chave API Google Gemini |
| `SCHEDULER_SECRET` | `SCHEDULER_SECRET` | Secret de autenticação do Cloud Scheduler |
| `BOT_BASE_URL` | Cloud Run URL | Obrigatório em produção para o `/setup` |

### Variáveis plain text

| Variável | Valor | Descrição |
|----------|-------|-----------|
| `UAZAPI_SERVER_URL` | `https://processai.uazapi.com` | URL do servidor UazAPI |

---

## Deploy

```bash
cd e-finance-bot
./deploy-bot.sh              # Deploy completo com testes
./deploy-bot.sh --skip-tests # Deploy sem rodar testes
```

O script:
1. Instala dependências npm
2. Roda testes (vitest)
3. Faz build TypeScript
4. Builda e pusha imagem Docker
5. Deploya no Cloud Run
6. Configura webhooks WhatsApp + Telegram via `POST /setup`
7. Cria ou atualiza o Cloud Scheduler job `morning-briefing`

### Detalhes do Cloud Run

- **Serviço:** `e-finance-bot`
- **Projeto:** `tribal-pillar-476701-a3`
- **Região:** `us-west1`
- **URL estável:** `https://e-finance-bot-485911123531.us-west1.run.app`
- **Service Account:** `485911123531-compute@developer.gserviceaccount.com`

---

## Cloud Scheduler — morning-briefing

### O que é

Um job que chama `POST /scheduler/morning-briefing` a cada 5 minutos. O endpoint verifica quais tenants têm o briefing matinal habilitado e se o horário configurado pelo tenant está dentro de uma janela de ±7 minutos do horário atual. Se sim, envia o briefing para os contatos configurados.

### Configuração atual

| Campo | Valor |
|-------|-------|
| Nome | `morning-briefing` |
| Schedule | `*/5 * * * *` (a cada 5 minutos) |
| Timezone | `America/Sao_Paulo` |
| URI | `https://e-finance-bot-485911123531.us-west1.run.app/scheduler/morning-briefing` |
| Método | `POST` |
| Header auth | `x-scheduler-secret: <SCHEDULER_SECRET>` |

### Por que a cada 5 minutos (não uma vez por dia)?

Cada tenant pode configurar um horário diferente para receber o briefing. O bot usa `isTimeWindowMatch(±7 min)` para verificar se o horário atual está dentro da janela do tenant. Com execuções a cada 5 minutos, nenhum tenant perde o horário configurado.

### Autenticação

O endpoint valida o header `x-scheduler-secret` contra o secret `SCHEDULER_SECRET` do Secret Manager.

**Armadilha conhecida:** Se o secret foi criado com `echo "valor" | gcloud secrets create ...`, ele contém trailing newline (`\n`). O bash strip isso em `$()` mas o Cloud Run injeta o valor raw com o `\n`. Por isso o `config.ts` usa `.trim()` ao ler o secret.

### Comandos úteis

```bash
# Verificar status do job
gcloud scheduler jobs describe morning-briefing \
  --project=tribal-pillar-476701-a3 --location=us-west1

# Disparar manualmente (para testar)
gcloud scheduler jobs run morning-briefing \
  --project=tribal-pillar-476701-a3 --location=us-west1

# Testar endpoint diretamente
SECRET=$(gcloud secrets versions access latest --secret=SCHEDULER_SECRET --project=tribal-pillar-476701-a3)
curl -X POST https://e-finance-bot-485911123531.us-west1.run.app/scheduler/morning-briefing \
  -H "Content-Type: application/json" \
  -H "x-scheduler-secret: ${SECRET}" \
  -d "{}"
```

Resposta esperada:
- `{"dispatched":0,"skipped":N,"errors":[]}` — sem tenants no horário atual (normal fora do horário)
- `{"dispatched":N,"skipped":M,"results":[...]}` — briefings enviados

---

## Webhooks

### Registro inicial

Após cada deploy, o script executa `POST /setup` para registrar os webhooks. O endpoint `/setup` registra:
- WhatsApp: webhook na UazAPI
- Telegram: webhook na Bot API

**Problema conhecido:** A UazAPI pode registrar o webhook sem `events` explícitos, o que faz o servidor não disparar nada. O deploy-bot.sh cuida disso, mas se mensagens pararem de chegar, verificar manualmente:

- `x-setup-secret` no `POST /setup`
- `BOT_BASE_URL` presente no ambiente de produção

```bash
# Verificar events na UazAPI
curl -s https://processai.uazapi.com/webhook \
  -H "token: <UAZAPI_INSTANCE_TOKEN>"

# Se events: [] ou ausente, registrar manualmente:
curl -X POST https://processai.uazapi.com/webhook \
  -H "Content-Type: application/json" \
  -H "token: <UAZAPI_INSTANCE_TOKEN>" \
  -d '{
    "url": "https://e-finance-bot-485911123531.us-west1.run.app/webhook/whatsapp/<UAZAPI_WEBHOOK_SECRET>",
    "enabled": true,
    "addUrlEvents": false,
    "addUrlTypesMessages": false,
    "events": ["messages","messages_update","connection","contacts","presence"],
    "excludeMessages": []
  }'
```

---

## Diagnóstico e Debug

### Health check

```bash
curl https://e-finance-bot-485911123531.us-west1.run.app/health
# Esperado: {"status":"healthy"}
```

### Logs em tempo real

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=e-finance-bot" \
  --limit=20 --format="json" \
  --project=tribal-pillar-476701-a3 --freshness=5m \
  | python3 -c "
import json,sys
logs=json.load(sys.stdin)
for e in logs:
  p = e.get('jsonPayload', e.get('textPayload',''))
  ts = e.get('timestamp','')[11:19]
  hr = e.get('httpRequest')
  if hr:
    print(f'{ts} | HTTP {hr.get(\"requestMethod\",\"?\")} {hr.get(\"requestUrl\",\"?\")} status={hr.get(\"status\",\"?\")}')
  elif p:
    print(f'{ts} | {p}')
"
```

### Eventos de log estruturados

| Evento | Significado |
|--------|-------------|
| `inbound_buffer_started` | Mensagem chegou e entrou no buffer |
| `inbound_buffer_flushed` | Buffer disparou para processamento |
| `bot_message_processed` | Mensagem processada |
| `morning_briefing_run` | Briefing executado — ver `dispatched` |
| `link_code_success` | Código de autenticação linkado |

### Filtro `fromMe`

O bot ignora mensagens com `fromMe: true` (linha ~90 do `index.ts`). Mensagens enviadas via API UazAPI de uma instância para outra podem chegar com `fromMe: true`. Para testes reais, usar um celular físico para enviar mensagem para o bot.

---

## Problemas Resolvidos

### Secret com trailing newline (2026-03-10)

**Sintoma:** `POST /scheduler/morning-briefing` retornava 401 mesmo com o secret correto.

**Causa:** O secret `SCHEDULER_SECRET` foi criado com trailing newline no Secret Manager. O Cloud Run injeta o valor raw (com `\n`), mas o `gcloud secrets versions access` retorna sem newline (bash strip via `$()`). Resultado: `secret_len=65` no container vs `received_len=64` no header.

**Fix:** `.trim()` ao ler `process.env.SCHEDULER_SECRET` em `config.ts`:
```typescript
secret: (process.env.SCHEDULER_SECRET || '').trim(),
```

### IAM do Cloud Scheduler (2026-03-10)

**Contexto:** O Cloud Scheduler job `morning-briefing` não existia. O SA `485911123531-compute@developer.gserviceaccount.com` já tinha `roles/secretmanager.secretAccessor` no projeto, mas o secret `SCHEDULER_SECRET` não tinha o binding explícito.

**Resolução:** O binding foi adicionado e o job foi criado. O `deploy-bot.sh` agora cria/atualiza o job automaticamente em cada deploy.
