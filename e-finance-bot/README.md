# e-finance-bot

Assistente conversacional do e-finance para WhatsApp e Telegram.

## Objetivo

Permitir operação natural por chat para funções de gestão financeira (dashboard, recebíveis, contratos, pagamentos, convite, relatório), com postura conservadora em ações sensíveis e fallback para LLM apenas quando necessário.

## Principais características

- Comunicação em PT-BR com linguagem natural.
- Roteamento híbrido de intenção:
  - Regras rápidas para intents comuns.
  - LLM (Gemini) só quando regra não resolve.
- Guardrails de segurança:
  - Bloqueio de tentativa de prompt injection.
  - Sanitização de entrada.
  - Confirmação explícita para ações sensíveis (ex.: baixar parcela).
- Dedupe de mensagens por `messageId`/`update_id` com TTL.
- Logs estruturados por mensagem para observabilidade.

## Stack

- Node.js + TypeScript + Express
- Supabase (service role)
- Gemini (`@google/genai`)
- Deploy em Google Cloud Run

## Estrutura de pastas

- `src/index.ts`: webhooks e bootstrap HTTP
- `src/handlers/message-handler.ts`: orquestração da conversa
- `src/ai/intent-router.ts`: roteador híbrido (regra -> LLM)
- `src/ai/intent-classifier.ts`: classificação de intenções e normalização
- `src/security/prompt-guard.ts`: detecção de prompt injection
- `src/actions/admin-actions.ts`: operações de negócio
- `src/channels/whatsapp.ts`: integração UazAPI
- `src/channels/telegram.ts`: integração Telegram Bot API
- `src/observability/logger.ts`: logs estruturados
- `src/utils/message-dedupe.ts`: deduplicação de mensagens
- `tests/`: suíte unitária e integração

## Endpoints

- `GET /` — status do serviço
- `GET /health` — healthcheck
- `POST /webhook/whatsapp` — entrada UazAPI
- `POST /webhook/telegram` — entrada Telegram
- `POST /setup` — configuração de webhooks dos canais

## Requisitos de ambiente

Variáveis obrigatórias:

- `PORT` (default `8080`)
- `UAZAPI_SERVER_URL` (default `https://processai.uazapi.com`)
- `UAZAPI_INSTANCE_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

## Rodando localmente

```bash
npm ci
npm run build
npm run dev
```

## Testes

```bash
npm test
```

## Deploy manual no Cloud Run (runbook oficial)

### 1) Variáveis fixas

```bash
PROJECT_ID="tribal-pillar-476701-a3"
REGION="us-west1"
SERVICE="e-finance-bot"
REGISTRY="us-west1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/e-finance-bot"
GIT_SHA="$(git -C ~/workspace/e-finance rev-parse HEAD)"
IMAGE="${REGISTRY}:${GIT_SHA}"
```

### 2) Pré-checks

```bash
gcloud config set project "${PROJECT_ID}"
gcloud auth list
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
```

### 3) Build e push

```bash
cd ~/workspace/e-finance/e-finance-bot
docker build -t "${IMAGE}" .
docker push "${IMAGE}"
```

### 4) Deploy

```bash
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --platform=managed \
  --region="${REGION}" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=60 \
  --set-secrets="UAZAPI_INSTANCE_TOKEN=UAZAPI_INSTANCE_TOKEN:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY_EFINANCE:latest,GEMINI_API_KEY=GEMINI_API_KEY_EFINANCE:latest" \
  --set-env-vars="UAZAPI_SERVER_URL=https://processai.uazapi.com,SUPABASE_URL=https://SUPABASE_PROJECT_URL_REMOVED"
```

### 5) Configurar webhooks

```bash
URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)')"

curl -s -X POST "${URL}/setup" \
  -H "Content-Type: application/json" \
  -d "{\"webhookBaseUrl\":\"${URL}\"}"
```

### 6) Smoke test pós-deploy

```bash
curl -s "${URL}/health"
curl -s "${URL}/"

gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.latestReadyRevisionName)'

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND jsonPayload.event=bot_message_processed" \
  --freshness=1h --limit=20 \
  --format='table(timestamp,jsonPayload.event,jsonPayload.channel,jsonPayload.messageId,jsonPayload.intent,jsonPayload.action,jsonPayload.result,jsonPayload.durationMs)'
```

## Rollback

Listar revisões:

```bash
gcloud run revisions list --service="${SERVICE}" --region="${REGION}"
```

Voltar tráfego para revisão estável:

```bash
gcloud run services update-traffic "${SERVICE}" --region="${REGION}" --to-revisions=REVISAO_ESTAVEL=100
```

## Observabilidade

Evento estruturado principal:

- `bot_message_processed`

Campos esperados:

- `channel`
- `messageId`
- `intent`
- `confidence`
- `routeSource`
- `action`
- `result`
- `durationMs`

## Segurança conversacional

- Tentativas de jailbreak/prompt injection são bloqueadas.
- O bot não revela prompt interno, credenciais ou segredos.
- Quando a confiança é baixa ou intenção ambígua, o bot pede clarificação antes de executar ação financeira.
- A baixa de parcela exige confirmação explícita do usuário.

## Integração com canais

### Telegram

- Recebe `message.text`, `voice`, `audio`, `photo`.
- Envia resposta em `parse_mode=HTML` com escape seguro.

### WhatsApp (UazAPI)

- Recebe `text`, `audioMessage`, `pttMessage`, `imageMessage`.
- `pttMessage` é aceito no gate inicial.

## Workflow de CI/CD

Há workflow dedicado em:

- `../.github/workflows/deploy-bot.yml`

Esse workflow também:

- publica imagem no Artifact Registry
- faz deploy no Cloud Run
- chama `POST /setup` após deploy

## Troubleshooting rápido

### `Bad Request: chat not found` no Telegram

Causa comum: teste sintético com `chat_id` inválido. Em produção, use chat real já iniciado com o bot.

### `/setup` retorna erro em canal

Validar:

- segredo do canal no Secret Manager
- token vigente
- conectividade externa da API do canal

### Sem logs de `bot_message_processed`

Validar:

- tráfego chegando no webhook correto
- filtros do Logging (`resource.type`, `service_name`, `freshness`)
- se a requisição foi deduplicada por `messageId`

## Contêiner oficial

Container canônico do serviço:

- `us-west1-docker.pkg.dev/tribal-pillar-476701-a3/cloud-run-source-deploy/e-finance-bot`

## Cadastro de Devedor por CPF (CPF-first)

- Ao criar contrato pelo bot, o CPF do devedor é obrigatório no fallback conversacional.
- O bot nunca escolhe devedor por homônimo (nome parecido) quando há CPF.
- Se o CPF já existir com nome diferente, o bot pergunta:
  - `1) usar nome cadastrado`
  - `2) substituir para o novo nome`
- O contrato só é criado após confirmação explícita.

Exemplo de frase:

```text
criar contrato para Ana Paula, CPF 529.982.247-25, 1000 por 2000, 10 parcelas, todo dia 5
```

## Baixa por Contrato (`Contrato #id`)

Após criar, o bot responde com `Contrato #<id>`.

Comandos suportados:

```text
baixar contrato 123
baixar contrato 123 parcela 2
pagar parcela 2 do contrato 123
mostrar mais
```

Regras do fluxo:

- Sem parcela explícita, o bot lista 3 parcelas por página.
- `mostrar mais` traz o próximo bloco de parcelas.
- A baixa só acontece após resposta de confirmação (`sim`).

## Consultas por Janela (Próximos X dias)

Exemplos de linguagem natural:

```text
quanto vou receber nos próximos 7 dias
quem devo cobrar nos próximos 7 dias
a partir de amanhã, quem devo cobrar nos próximos 3 dias
```

Semântica da janela:

- `próximos X dias` inicia em **hoje**
- `a partir de amanhã` inicia em **amanhã**
- `X` default = `7` quando não informado
- `X` limitado entre `1` e `60`

## Buffer Adaptativo de Mensagens

Quando o cliente envia mensagens em sequência, o bot agrega no mesmo processamento:

- Ex.: `oi` + `tudo bom` => `oi, tudo bom`
- Limites padrão:
  - `INBOUND_BUFFER_DEBOUNCE_MS=3500`
  - `INBOUND_BUFFER_MAX_WINDOW_MS=12000`
  - `INBOUND_BUFFER_MAX_MESSAGES=5`
- Bypass imediato para:
  - comandos (`/dashboard`, `/start`, etc.)
  - confirmações/cancelamentos (`sim`, `não`, `cancelar`)
  - seleção numérica curta (`1`, `2`, ...)
  - mídia (áudio/foto)

## Validação SQL das Janelas

Script automático (cenário controlado) que compara bot vs SQL:

```bash
npm run test:window-validation
```

Ele valida janelas `1, 3, 7, 15, 30` dias e falha se houver divergência entre total do bot e total do banco.
