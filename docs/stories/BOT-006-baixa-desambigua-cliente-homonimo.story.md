# BOT-006 — Baixa por nome desambigua clientes homônimos

**Agentes:** @dev (impl) → @qa (gate) → @devops (push)
**Status:** Ready for Review (QA PASS; aguardando @devops push/deploy)
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01
**Prioridade:** P0 — segurança de mutação financeira (risco de baixar no cliente errado)
**Banco:** sem mudança de schema/RPC
**Origem:** teste de estresse de erro humano (sugerido pelo usuário) — dois clientes com nome idêntico e mesma dívida.

---

## 1. Problema

No fluxo de **baixa por nome do devedor + mês**, `getInstallmentByDebtorAndMonth` fazia `.ilike(nome).limit(N)` e usava **`debtors[0]` silenciosamente**. Com dois clientes distintos de mesmo nome (CPFs diferentes), o bot operava no primeiro perfil **sem avisar que havia outro** — risco de o admin dar baixa no **cliente errado**.

Contraste: o fluxo de **saldo** (`query_debtor_balance`) já desambiguava (lista com CPF). A baixa — operação **mutante e irreversível** — era a que não protegia.

Comprovado ao vivo: criados dois "João Silva" (CPFs `…-25` e `…-35`), `quanto o João Silva deve` desambiguava, mas `baixar a parcela de junho do João Silva` não.

## 2. Acceptance Criteria

- **AC-1:** Nome que casa com mais de um cliente distinto → o bot **pergunta qual cliente** (lista com CPF mascarado) antes de qualquer baixa; `markInstallmentPaid`/`payBulletInterest` não são chamados.
- **AC-2:** Escolha por **número** ou **final do CPF** resolve o cliente certo e segue para a confirmação normal.
- **AC-3:** Escolha inválida re-pergunta; nunca baixa às cegas.
- **AC-4:** Não regredir BOT-FIX-001 — a escolha de cliente não é sequestrada por seleção de empresa pendente, e (decisivo) **não usa `candidateSets.debtors`** (que o `followup-resolver` sequestraria para `query_debtor_balance`); os candidatos ficam privados na capability (`pendingOperationInput.debtor_candidates`).

## 3. Implementação

- `src/actions/admin-actions.ts`: `getInstallmentByDebtorAndMonth` ganhou param `preselectedDebtorId` e, quando o nome casa com >1 perfil e não há preselect, retorna `ambiguousDebtors: DebtorCandidate[]` (em vez de `debtors[0]`).
- `src/assistant/executors/mark-installment-paid.ts`: input `debtor_id`/`debtor_candidates`; ramo `debtor_name+installment_month` trata `ambiguousDebtors` → pergunta o cliente; interceptação de `debtor_choice` no topo do resolve (espelha o padrão de `bullet_mode`); helpers `formatDebtorChoiceMessage`/`resolveDebtorChoice` (ordinal + sufixo de CPF).

## 4. Evidências

- Gate de estresse `tests/stress-flows.test.ts` (8/8): homônimo pergunta cliente (sem `markInstallmentPaid`), escolha ordinal/CPF resolve, escolha inválida re-pergunta, no-company-hijack, confirmação ambígua não executa, seleção fora do range não baixa, CPF malformado re-pede.
- `npm test`: **310 passed / 4 skipped**; `tsc --noEmit` 0.
- Live prod-like (`scripts/live-stress-samename.ts`): com histórico limpo, `baixa_desambigua: true` — "Encontrei 2 clientes… 1. …-25  2. …-35". Função direta retorna `ambiguous(2)`.

## 5. QA Gate

- [x] AC-1: homônimo pergunta qual cliente antes da baixa; `markInstallmentPaid`/`payBulletInterest` não executam às cegas.
- [x] AC-2: escolha por número/final de CPF resolve o cliente e segue para confirmação normal.
- [x] AC-3: escolha inválida re-pergunta e não baixa.
- [x] AC-4: candidatos privados na capability; não usa `candidateSets.debtors`; não regride BOT-FIX-001.
- **Verdict:** ✅ **PASS** — pronto para `@devops *push` (aguardando autorização; push = deploy prod).

## 6. BOT-007 — subitem oficial: contract_id inferido pelo LLM sob homônimos (IMPLEMENTADO)

**Decisão documental:** manter BOT-007 como subitem oficial de BOT-006, sem criar story própria. Motivo: o risco, o fix e as evidências pertencem ao mesmo domínio de segurança de homônimos na baixa; criar story separada agora duplicaria artefatos sem acrescentar gate novo.

O teste live revelou que o **classificador LLM injeta um `contract_id`** a partir do histórico (ex.: contratos recém-criados). "baixar a parcela de junho do João Silva" logo após criar contratos vinha como `{"debtor_name":"João Silva","installment_month":6,"contract_id":<n>}` → o resolve tomava o ramo `contract_id+month` e **pulava a desambiguação por nome** → risco de baixa no **João errado**.

**Fix (BR-BOT-014):**
- `src/actions/admin-actions.ts`: nova `searchDebtorsByName(tenantId, name)`.
- `src/assistant/executors/mark-installment-paid.ts`: guarda antes dos ramos de `contract_id` — quando há `debtor_name` + `contract_id` (sem pessoa resolvida) e o nome casa com >1 cliente, **descarta o contract_id** e desambigua a pessoa; ao escolher, `contract_id` é limpo e a baixa resolve por `debtor_id`+mês.
- `src/ai/tools/handlers.ts` (AI-native ativo nos tenants com `ai_enabled`): mesma guarda em `resolveInstallmentForPayment` (variante `ambiguous_debtor`) — defense-in-depth.

**Evidências:** `stress-flows.test.ts` +2 casos (`stress-homonimo-contract_id-inferido-*`, 10/10); `npm test` **312 passed / 4 skipped**; live (`scripts/live-stress-samename.ts`) com histórico cheio: `baixa_desambigua: true` mesmo com o LLM injetando `contract_id`. **Verdict:** ✅ PASS.

## 7. File List (realizado)

| Arquivo | Mudança |
|---------|---------|
| `e-finance-bot/src/actions/admin-actions.ts` | `getInstallmentByDebtorAndMonth` com `preselectedDebtorId`; retorno de `ambiguousDebtors`; `searchDebtorsByName` para BOT-007 |
| `e-finance-bot/src/assistant/executors/mark-installment-paid.ts` | estado privado `debtor_candidates`; escolha por ordinal/final CPF; guarda contra `contract_id` inferido sob homônimos |
| `e-finance-bot/src/ai/tools/handlers.ts` | defense-in-depth AI-native para `ambiguous_debtor` quando `contract_id` vem junto de nome homônimo |
| `e-finance-bot/tests/evals/stress-flows.ts` | cenários determinísticos de homônimos, escolhas inválidas e BOT-007 |
| `e-finance-bot/tests/stress-flows.test.ts` | gate dos cenários de stress (`10/10` após BOT-007) |
| `e-finance-bot/scripts/live-stress-samename.ts` | validação live prod-like com dois clientes homônimos e histórico cheio |
| `docs/stories/BOT-006-baixa-desambigua-cliente-homonimo.story.md` | story + decisão de manter BOT-007 como subitem oficial |
