# Changelog — e-finance-bot

## [2026-05-18] — Busca inteligente para dar baixa (mark_installment_paid)

### Objetivo
- Reduzir fricção no fluxo de "dar baixa" (marcar parcela como paga).
- Eliminar pedido redundante de "mês" quando admin informava nome do devedor.
- Tornar confirmação mais tolerante a variações informais de linguagem.
- Validar feature com 265 casos de teste end-to-end.

### Implementação

#### Novas Funcionalidades
- **`getOpenInstallmentsByDebtorName()` em `src/actions/admin-actions.ts`**
  - Busca fuzzy por nome (ilike %pattern%) em profiles.full_name
  - Retorna todas as parcelas abertas (pending/late/partial) para devedores casados
  - Ordena por due_date ascendente (parcela mais vencida = prioridade)
  - Limita a 6 resultados
  - Motivo: permitir busca automática inteligente sem pedir "qual mês?"

- **Smart executor em `src/assistant/executors/mark-installment-paid.ts`**
  - Se `debtor_name` + 0 parcelas encontradas → "Não encontrei nenhum devedor com nome parecido"
  - Se `debtor_name` + 1 parcela → vai direto pra confirmação (0 turnos extras)
  - Se `debtor_name` + N parcelas → mostra lista numerada, seleciona por número
  - Suporta ordinal flexível: "1", "primeira", "a primeira", "item 2", "opção 3", "número 4"
  - Motivo: reduzir de 4 para 2 turnos no caso comum

- **Confirmação tolerante em `src/assistant/confirmation-store.ts`**
  - Expande `parseConfirmationReply()` para aceitar: "tá", "ta", "certo", "beleza", "blz", "perfeito", "isso mesmo", "pode ser", "pode confirmar", "bora", "combinado", "yes"
  - Anterior: apenas "sim", "não", "confirmo", "ok" exatos
  - Motivo: reconhecer confirmação informal do admin

#### Testes & Validação
- **`tests/smart-baixa-evals.test.ts`** — 265 casos de teste
  - Functional (dar baixa core): 125/125 = **100%** ✓
  - Multi-turn (seleção): 48/85 = 56.5%
  - Regressions: 18/45 = 40%
  - Adversarial: 5/10 = 50%
  - **Total: 196/265 = 73.9%**
  - Gates passaram: critical ≥80% (82.9%), core ≥70% (70.5%), functional ≥95% (100%)

### Impacto
| Cenário | Antes | Depois | Ganho |
|---------|-------|--------|-------|
| 1 parcela | 4 turnos | 2 turnos | **-50%** |
| N parcelas | 4 turnos | 3 turnos | **-25%** |
| Confirmação com "tá" | ❌ Falha | ✅ Sucesso | **Novo** |

### Arquivos Alterados
- `src/actions/admin-actions.ts` — +getOpenInstallmentsByDebtorName()
- `src/assistant/executors/mark-installment-paid.ts` — smart debtor search logic
- `src/assistant/confirmation-store.ts` — expanded confirmation words
- `tests/evals/chunks/chunk-04-edge.ts` — edge case validation (25 casos)
- `tests/smart-baixa-evals.test.ts` — 265-case eval suite
- `tests/evals/harness.ts` — mock para nova função

---

## [2026-03-30] — Migração final de mutações sensíveis para capabilities dedicadas

### Objetivo
- Tirar `create_contract` e `mark_installment_paid` do `legacy-dispatch`.
- Manter `WorkingStateV2` como estado canônico.
- Deixar o `tool-executor` mais fino e mais registry-driven.
- Preservar confirmação explícita, tenant isolation e resposta fiel ao resultado estruturado.

### Alterado
- **`src/assistant/contracts.ts`**
  - Estendidos os contratos de runtime (`CapabilityRuntimeContext`, `CapabilityResolveResult`, `CapabilityExecuteResult`) e o estado (`pendingOperationInput`) para suportar resolução/autorização/execução por capability.
  - Motivo: parar de depender de inferência espalhada entre handler, executor e legado.

- **`src/assistant/legacy-state-adapter.ts`**
  - O adapter deixou de espelhar `create_contract` e `mark_installment_paid` para `pendingAction/pendingStep/pendingData` quando o fluxo já está no estado novo.
  - Motivo: evitar dualidade de memória e confirmações inconsistentes nesses dois fluxos.

- **`src/assistant/executors/create-contract.ts`** (novo)
  - Capability dedicada com `inputSchema`, `resolve`, `authorize`, `execute` e `formatResult`.
  - `resolve` consolida draft pendente + texto atual, detecta campos faltantes, gera preview fiel e exige confirmação antes da gravação.
  - `execute` trata `conflict_name` como clarificação estruturada e não volta para o legado.
  - Motivo: fechar a migração do contrato para o runtime novo.

- **`src/assistant/executors/mark-installment-paid.ts`** (novo)
  - Capability dedicada com resolução determinística de parcela por contrato/parcela, contrato/mês ou devedor/mês.
  - Persiste candidate set útil para follow-up curto, exige confirmação e respeita replay idempotente por sessão/confirmação.
  - Motivo: remover a baixa de pagamento do `legacy-dispatch` sem perder segurança.

- **`src/assistant/tool-executor.ts`**
  - Passou a executar capabilities registry-driven via `inputSchema -> resolve -> policy -> confirmation -> authorize -> execute -> formatResult`.
  - Mantém replay benigno para mutações já confirmadas no mesmo chat.
  - Motivo: concentrar o runtime genérico e tirar lógica específica do executor central.

- **`src/assistant/capability-registry.ts`** e **`src/assistant/action-planner.ts`**
  - `create_contract` e `mark_installment_paid` agora apontam para capabilities dedicadas.
  - `requiresConfirmation` passa a vir do registry para o planner.
  - Motivo: consolidar o contrato de execução na registry.

- **`src/assistant/followup-resolver.ts`**
  - Adicionado suporte a follow-up por `pendingCapability` para os dois fluxos migrados.
  - Motivo: manter multi-turn curto sem cair no legado.

- **`src/handlers/message-handler.ts`**
  - Confirmações desses fluxos agora passam pelo runtime novo.
  - Cancelamento/escape de fluxo pendente passa a limpar apenas `WorkingStateV2`.
  - Ajustado o prefixo `Entendi do áudio` para o novo wording de confirmação.
  - Motivo: o handler fica mais orquestrador e menos dono da lógica.

- **`src/actions/admin-actions.ts`**
  - Adicionado helper determinístico `getContractOpenInstallmentByMonth(...)`.
  - Motivo: resolver baixa por mês sem branch legado.

- **`src/ai/response-generator.ts`**
  - A naturalização passou a priorizar o `baseText`/`StructuredResponse` correto do runtime novo.
  - Motivo: evitar reinterpretação errada da operação executada.

- **`src/session/session-manager.ts`** e **`src/assistant/working-state-store.ts`**
  - Tipagem e persistência alinhadas com `workingStateV2`.
  - Motivo: manter o estado único como contrato real.

### Bugs reais corrigidos durante a rodada
- **CPF sobrescrevendo `amount` em `create_contract`**
  - Causa: o fallback textual de contrato aceitava número curto fora de contexto e podia promover dígitos do CPF para o campo de valor.
  - Correção: o patch textual genérico agora só preenche campos faltantes; respostas curtas são tratadas por slot focado.

- **Slot filling curto não resolvia `due_day`**
  - Causa: ao pedir `dia do mês`, a resposta `10` não era interpretada no fluxo novo.
  - Correção: `create_contract.resolve()` passou a aceitar respostas curtas focadas por campo pendente (`due_day`, `rate`, `installments`, `weekday`, `start_date`, `rename_mode`, etc.).

- **Artefatos `._*` do macOS quebrando o Vitest no `pc1`**
  - Causa: sincronização por `tar` carregou AppleDouble files para dentro de `src/` e `tests/`.
  - Correção: limpeza recursiva dos `._*` no repo remoto.

### Testes e validação
- **Novo teste:** `tests/tool-executor.mutations.test.ts`
  - Cobre:
    - `create_contract` happy path com confirmação
    - `create_contract` missing args
    - `create_contract` bloqueio por role
    - `create_contract` conflito de nome
    - `mark_installment_paid` confirmação
    - `mark_installment_paid` múltiplos candidatos
    - idempotência por replay
    - ausência de fallback para `legacy-dispatch`

- **Testes ajustados**
  - `tests/message-handler.test.ts`
  - `tests/conversation-smoke.test.ts`
  - `tests/working-state-store.test.ts`
  - `tests/evals/harness.ts`
  - `tests/evals/dataset.ts`

- **Validação no `pc1`**
  - `npm run build -- --pretty false` → ok
  - `npm test` → **22 arquivos, 142 testes passando**
  - `npm run test:agent-evals` → **19/19 passando**

### Riscos remanescentes
- O legado ainda existe para fluxos não migrados; esta rodada removeu a dependência apenas para `create_contract` e `mark_installment_paid`.
- A idempotência continua `session-scoped + confirmation-scoped`; ainda não é uma garantia global cross-instance.
- Não houve deploy nesta rodada de changelog; esta nota documenta o estado do código e da validação no `pc1`.


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
