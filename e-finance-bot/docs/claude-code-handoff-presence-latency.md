# Handoff Claude Code - Presença + Latência (05/03/2026)

## Objetivo da revisão
Aplicar o plano de:
- `typing` estrito no Telegram (`+3s` e visível por `>=1s`),
- presença no WhatsApp apenas para respostas lentas,
- redução de latência no backend com roteamento em 2 passos,
- persistência híbrida assíncrona de histórico,
- observabilidade de performance por etapa.

## O que foi adicionado/alterado

### 1) Presença conversacional por canal
Arquivo: `src/channels/presence.ts`

- Mantido Telegram estrito:
  - agenda início de presença em `startDelayMs` (default `3000`),
  - envia `sendChatAction('typing')`,
  - mantém pulso periódico (`telegramPulseMs`, default `4000`),
  - antes de responder garante janela mínima visível (`minVisibleMs`, default `1000`).
- WhatsApp agora em modo `slow-only`:
  - se o processamento terminar antes do threshold, não envia presença,
  - ao ultrapassar threshold, usa `setInstancePresence('available')` e fecha com `unavailable` ao final,
  - concorrência protegida por contador global (`activeWhatsappPresenceCount`) e serialização de chamadas.
- Eventos de log de presença:
  - `presence_scheduled`, `presence_started`, `presence_stopped`, `presence_failed`.

### 2) Configurações novas
Arquivo: `src/config.ts`

- `presence.whatsappSlowOnly` -> `PRESENCE_WHATSAPP_SLOW_ONLY` (default `true`)
- `presence.whatsappSlowThresholdMs` -> `PRESENCE_WHATSAPP_SLOW_THRESHOLD_MS` (default `2500`)
- `messagePersistence.mode` -> `MESSAGE_PERSISTENCE_MODE` (`sync|hybrid`, default `hybrid`)
- `messagePersistence.retryCount` -> `MESSAGE_PERSISTENCE_RETRY_COUNT` (default `2`)
- `messagePersistence.retryBaseMs` -> `MESSAGE_PERSISTENCE_RETRY_BASE_MS` (default `200`)

### 3) Roteamento em 2 passos (rápido -> completo)
Arquivos: `src/ai/intent-router.ts`, `src/handlers/message-handler.ts`

- `routeIntent` agora aceita `options.mode`:
  - `fast`: só regra determinística (sem histórico/LLM),
  - `full`: habilita fallback LLM compacto quando necessário.
- No `message-handler`:
  - primeiro chama `routeIntent(..., mode: 'fast')`,
  - só busca histórico e chama `mode: 'full'` quando `fast` não resolve com confiança alta.
- Efeito esperado:
  - comandos e intents fortes (`/dashboard`, `/start`, `cobrar hoje`, etc.) não pagam custo de histórico + LLM.

### 4) Persistência híbrida de mensagens
Arquivo: `src/session/session-manager.ts`

- `saveMessage` agora suporta modo híbrido:
  - em `hybrid`, gravação vai para fila em memória por sessão,
  - grava assíncrono com retry curto (`retryCount`, `retryBaseMs`),
  - falha final não bloqueia resposta e gera log `message_persist_failed`.
- Operações de estado conversacional crítico continuam síncronas:
  - `updateSessionContext`, `clearSessionContext`, `linkProfileToSession`.

### 5) Observabilidade de latência
Arquivos: `src/handlers/message-handler.ts`, `src/observability/logger.ts`

- Novo evento: `latency_breakdown` com campos:
  - `routeMs`, `dbReadMs`, `dbWriteMs`, `llmMs`, `presenceWaitMs`, `totalMs`.
- `bot_message_processed` passou a incluir os mesmos campos de breakdown.
- Campos adicionais:
  - `presenceMode` (`telegram_strict|whatsapp_slow_only|whatsapp_strict|disabled`),
  - `messagePersistMode` (`sync|hybrid`).

## Arquivos alterados nesta revisão
- `src/config.ts`
- `src/channels/presence.ts`
- `src/ai/intent-router.ts`
- `src/handlers/message-handler.ts`
- `src/session/session-manager.ts`
- `src/observability/logger.ts`
- `tests/presence.test.ts`
- `tests/intent-router.test.ts`
- `tests/message-handler.test.ts`

## Testes executados

- `npm test -- --run tests/message-handler.test.ts tests/intent-router.test.ts tests/presence.test.ts`
- `npm test`
- `npm run build`

Resultado final local: `53 passed`, build OK.

## Deploy realizado

- Serviço: `e-finance-bot`
- Região: `us-west1`
- Revisão ativa: `e-finance-bot-00013-rsl`
- URL: `https://e-finance-bot-oh6s7bvufq-uw.a.run.app`
- `/setup` executado após deploy (`whatsapp=ok`, `telegram=ok`)
- `/health` OK (`{"status":"healthy"}`)

Env vars novas aplicadas no Cloud Run:
- `PRESENCE_WHATSAPP_SLOW_ONLY=true`
- `PRESENCE_WHATSAPP_SLOW_THRESHOLD_MS=2500`
- `MESSAGE_PERSISTENCE_MODE=hybrid`
- `MESSAGE_PERSISTENCE_RETRY_COUNT=2`
- `MESSAGE_PERSISTENCE_RETRY_BASE_MS=200`

## Como validar rapidamente em produção

1. Telegram: enviar mensagem curta e observar `typing` iniciar ~3s depois e resposta após visibilidade mínima.
2. WhatsApp: enviar mensagem simples e confirmar que não alterna presença em respostas rápidas.
3. WhatsApp: enviar mensagem que force processamento mais longo (ex.: áudio + intenção ambígua) e confirmar presença durante processamento.
4. Logs: consultar `latency_breakdown` e comparar `p50/p95` com baseline anterior.

## Observações para próximas iterações

- `presenceWaitMs` ainda está instrumentado no payload, mas não separado do total no wrapper de presença; se necessário, medir explicitamente no wrapper e propagar no contexto da requisição.
- Se houver necessidade de durabilidade forte da fila de histórico em cenários de crash, evoluir de fila em memória para fila externa (ex.: Pub/Sub) mantendo o mesmo contrato de `saveMessage`.
