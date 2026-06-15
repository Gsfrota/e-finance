# Parity Baseline — Fase 0 do motor determinístico

> **Propósito:** congelar o comportamento atual do assistente admin antes de refatorar para o executor de
> grafo único (ver `bot-deterministic-engine.md`). Toda fase seguinte deve manter este gate **100% verde**.

## Como rodar

```bash
npm run test:parity
```

100% offline (não precisa de `GEMINI_API_KEY`, Supabase nem rede). O LLM do `intent-router` é mockado nos
testes; tudo aqui exercita o caminho **determinístico**.

## Baseline congelado (2026-06-14)

**199 testes / 15 suítes / ~5.7s — todos verdes.** Esse é o piso intocável.

> **Fase 1 (2026-06-14):** o gate cresceu para **212 testes / 16 suítes** com
> `i18n-messages.test.ts` (+13). Lotes externalizados para `t(key)` com paridade
> exata: (1) `fast-path` (saudação/help/thanks…), (2) respostas de sistema do
> `tool-executor`/orchestrator (`action_not_allowed` deduplicada 3→1,
> `validate_failed`, `ai_disabled`, `budget_exceeded`, `kill_switch`,
> `generic_error`), (3) família "Não entendi" do `message-handler`. Regra mantida:
> o gate só cresce, nunca encolhe.
>
> **Fase 2 — slice 1 (2026-06-14):** gate em **213** com o teste de caracterização de idempotência do
> `create_contract` (replay de confirmação não duplica contrato) em `tool-executor.mutations.test.ts` —
> trava o invariante do caminho-alvo da convergência.
>
> **Fase 2 — slice 2 (2026-06-14):** gate em **216** com `tests/engine/create-contract-routing.test.ts`
> (+3). Prova — sem mocks — que `create_contract` já está **100% convergido no caminho-capability** e que
> o wizard legado (`pendingAction='criar_contrato'` no `message-handler`) é **inalcançável**: a capability
> é executor real e idempotente, **não** tem `legacyIntent` (logo `executeActionPlan` nunca delega ao
> `dispatchIntent` legado) e o planner mapeia a intent → capability. Guarda de deleção: se o legado for
> religado, o gate quebra.
>
> **Fase 2 — slice 3 (2026-06-14): RETIRADA do legado.** Deletado o wizard morto do `message-handler`
> (`dispatchIntent` case `criar_contrato`; blocos `handlePendingAction` `resolver_nome_cpf` + `criar_contrato`;
> helpers órfãos `extractAllContractEntities`/`mergeContractEntities`/`getNextMissingStep`/`getStepPrompt`/
> `suggestFirstInstallmentDate`/`CPF_REQUIRED_MSG` e sub-helpers exclusivos) — **894 linhas removidas**, imports
> mortos limpos. Comportamento idêntico provado pelos 49 testes de `contract-flows.test.ts` (wizard via
> capability) + os 3 de routing. Gate segue **216/216**, `tsc` limpo. A flag `features.fsm_via_capability`
> ficou **desnecessária** (não havia o que rotear).
>
> **Fase 3 — slice 1 (2026-06-14):** gate em **219** com `tests/engine/mark-payment-routing.test.ts` (+3),
> espelho do guard de create_contract: prova — sem mocks — que `mark_installment_paid` é executor real e
> idempotente, **não** tem `legacyIntent` e que o planner mapeia `marcar_pagamento` → capability. Enquanto
> valer, o wizard legado de baixa é inalcançável e o re-religamento quebra o gate.
>
> **Fase 3 — slice 2 (2026-06-14): RETIRADA do legado de baixa.** Deletado o wizard morto do `message-handler`
> (`dispatchIntent` case `marcar_pagamento`; blocos `handlePendingAction` `marcar_pagamento_contrato` +
> `marcar_pagamento` + `marcar_pagamento_por_mes`; helpers `startPaymentByContractFlow`/`startPaymentByDebtorMonthFlow`
> e órfãos `extractDebtorFromPaymentText`/`extractInstallmentNumberFromText`/`isShowMoreCommand`/`MONTH_NAMES`/
> `formatInstallmentsForSelection`/`formatInstallmentsForContractSelection`/`formatPaymentConfirmation`; imports mortos
> `markInstallmentPaid`/`getContractOpenInstallmentByNumber`/`getInstallmentByDebtorAndMonth`/`formatComprovante`/
> `inferInstallmentMonth`; params órfãos de `handlePendingAction`). **PRESERVADOS** (vivos): `listContractOpenInstallmentsReadOnly`
> e `formatInstallmentsForContractReadOnly` (usados pelo case vivo `listar_recebiveis`) e `getContractOpenInstallments`.
> A baixa roda 100% pela capability idempotente `mark_installment_paid`. O único teste que exercitava o legado
> (`fluxo mostrar mais em baixa por contrato`) **seedava `pendingAction` direto no mock** — bypassa o pipeline,
> não prova rota viva; foi reescrito como **contrato de depreciação**: sessão legada presa degrada graciosamente
> ("Contexto expirado", sem paginar, sem chamar `markInstallmentPaid`). Gate **219/219**, `tsc` e `lint` limpos,
> suíte não-live 378/378.

| Suíte | O que congela |
|---|---|
| `i18n-messages.test.ts` (10) | helper `t(key)`, override por tenant, e paridade exata das respostas do fast-path |
| `intent-router.test.ts` (25) | roteamento determinístico das 39 intents + extração de entidades por regra |
| `intent-classifier.test.ts` (6) | extração de entidades (CPF, valor, taxa, parcelas) |
| `command-understanding.test.ts` (2) | smalltalk + janelas em meses |
| `followup-resolver.test.ts` (8) | follow-ups curtos ("o outro", "e amanhã?", refino de parcela) |
| `working-state-store.test.ts` (2) | TTL + merge do `workingState` em `bot_sessions.context` |
| `tool-executor.mutations.test.ts` (8) | execução das mutações (create_contract, mark_paid) |
| `contract-flows.test.ts` (49) | **wizards multi-turno** criar-contrato + baixa (todos os caminhos) |
| `message-handler.test.ts` | orquestração do pipeline |
| `conversation-smoke.test.ts` | conversas-ouro fim-a-fim |
| `session-manager.test.ts` (2) | binding de canal + persistência de sessão |
| `probe-create.test.ts` | matriz de criação de contrato |
| `probe-baixa.test.ts` (3) | matriz de baixa de parcela |
| `probe-view.test.ts` (2) | consultas read-only |
| `confirmation-lexicon.test.ts` (50) | léxico de confirmação "sim/não" |
| `prompt-guard.test.ts` | bloqueio de injection |

## Regra de regressão

Este conjunto é o **gate de paridade** das Fases 1–5. Antes de mergear qualquer fase da migração para o
executor de grafo, `npm run test:parity` tem que continuar **199/199 verde** (ou crescer — nunca encolher
nem mudar expectativa sem justificativa explícita). Se um número mudar, é regressão até prova em contrário.

## Suítes deliberadamente fora do gate

Excluídas por dependerem de rede/IA real (não determinísticas): `*.live.test.ts`,
`ai-native-realdata.test.ts`, `conversation-orchestrator.e2e.test.ts`, `natural-*.live.test.ts`,
`agent-evals.test.ts`, `nlu-curated-eval.test.ts`. Continuam rodando via `npm run test`, mas não são gate
de paridade determinística.
