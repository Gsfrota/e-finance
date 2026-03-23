# Changelog — e-finance-bot

## [2026-03-23] — Hardening multiempresa conversacional

- Bot passou a entender referências de empresa mais naturais no chat admin, como `matriz`, `filial`, `empresa 2` e frases inline do tipo `dashboard da empresa X`.
- Quando a referência de empresa é ambígua, o bot agora para e pede clarificação antes de executar a consulta.
- Logs estruturados do fluxo administrativo passaram a carregar `tenantId`, `companyId` e `companyLabel`, melhorando rastreio por empresa.
- Evals e smoke live foram ampliados para cobrir seleção de empresa, limpeza de contexto e ambiguidade de apelidos.

## [2026-03-23] — Contexto de empresa inline no chat

### Alterado
- **`src/handlers/message-handler.ts`** — o admin agora pode citar a empresa na própria frase, como `dashboard da empresa X` ou `cobrar hoje da empresa Y`, e o bot ativa esse contexto no mesmo turno.
- **`src/actions/admin-actions.ts`** — dashboard, recebíveis, cobrança e relatório passaram a aceitar filtro opcional por `company_id`.
- **`src/assistant/contracts.ts`** e **`src/assistant/tool-executor.ts`** — o `workingState` passou a guardar `activeCompany`, e o executor moderno aplica esse contexto nas consultas administrativas.

### Testes
- **`tests/message-handler.test.ts`** — cobre `quais empresas` e `dashboard da empresa X`.
- **`tests/conversation-smoke.test.ts`** — cobre seleção inline e reaproveitamento do contexto de empresa em turnos seguintes.

## [2026-03-05] — NLP Natural + Confirmação + Agente Real

### Adicionado
- **`src/ai/response-generator.ts`** (novo) — `generateAgentResponse()` usa Gemini 2.0 Flash Lite
  (temperatura 0.7, max 120 tokens) para gerar respostas naturais em PT-BR.
  Fallback automático para template se LLM timeout. Controlado por `LLM_RESPONSE_ENABLED`.

- **`inferInstallmentMonth(text)`** em `intent-classifier.ts` — converte nomes de meses
  em número (1–12): "janeiro" → 1, "fev" → 2, "mês passado" → relativo ao mês atual.

- **Entidades `installment_month` e `installment_year`** em `NormalizedEntities` —
  extraídas tanto por regex local quanto pelo LLM classifier.

- **`getInstallmentByDebtorAndMonth()`** em `admin-actions.ts` — busca parcela aberta
  de um devedor pelo nome (ilike) e mês de vencimento no banco.

- **Fluxo por nome + mês em `marcar_pagamento`** (`message-handler.ts`) —
  "dar baixa na parcela de janeiro de Icaro Soares" resolve o devedor, busca a parcela,
  exibe card de confirmação e aguarda "sim/não" antes de executar.

- **`startPaymentByDebtorMonthFlow()`** — novo handler assíncrono para o fluxo devedor+mês
  com suporte a múltiplas parcelas encontradas (lista para escolha).

- **Pending action `marcar_pagamento_por_mes`** — mantém estado multi-turno do novo fluxo.

- **Respostas naturais via LLM** em: `cobrar_hoje`, `recebiveis_hoje`, sucesso de pagamento
  e intent `desconhecido`.

### Alterado
- **`intent-router.ts`** — novos padrões no array RULES:
  - "quem ta me devendo hoje", "quem me deve hoje", "quem devo cobrar" → `cobrar_hoje`
  - "quitar parcela", "baixar pagamento", "parcela do mês de" → `marcar_pagamento`
  - "qual a dívida de", "me fala da dívida de" → `buscar_usuario`
  - `inferPaymentByContractEntities()` agora extrai `installment_month` quando presente

- **`intent-classifier.ts`** — prompt compacto do LLM atualizado com exemplos coloquiais
  e documentação do campo `installment_month` para extração.

- **`config.ts`** — nova seção `llmResponse`:
  - `LLM_RESPONSE_ENABLED` (default: `true`)
  - `LLM_RESPONSE_TIMEOUT_MS` (default: `1500`)
  - `LLM_RESPONSE_MAX_TOKENS` (default: `120`)

### Deploy
- **Revisão:** `e-finance-bot-00014-jh4`
- **Região:** `us-west1`
- **URL:** `https://e-finance-bot-485911123531.us-west1.run.app`

---

## [2026-03-05] — Presença + Latência (revisão anterior)

### Adicionado
- Typing indicator estrito no Telegram (+3s delay, mínimo 1s visível)
- WhatsApp em modo `slow-only` (presença só em respostas > 2.5s)
- Roteamento em 2 passos: `fast` (regras) → `full` (LLM se necessário)
- Persistência híbrida de histórico com retry assíncrono
- Evento `latency_breakdown` com campos `routeMs`, `dbReadMs`, `llmMs`, etc.

### Deploy
- **Revisão:** `e-finance-bot-00013-rsl`
