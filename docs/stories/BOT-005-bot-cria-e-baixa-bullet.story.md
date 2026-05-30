# BOT-005 — Bot cria e baixa contratos bullet (juros simples / interest-only rotativo)

**Agentes:** @pm (spec) → @sm (draft) → @po (validate) → @dev (impl) → @qa (gate) → @devops (push)
**Status:** In Progress
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01 (item novo, derivado da campanha de QA contínuo)
**Prioridade:** P1 — paridade de produto com o app web (admin-only)
**Banco:** **sem mudança de schema/RPC** — usa `create_investment_validated` e `pay_bullet_interest_only` já existentes (migration v29 / CB-005/CB-006). Gate do guardião satisfeito (inspeção read-only confirmou as assinaturas reais).

---

## 1. Contexto

O app web já permite contratos **bullet (juros simples / `calculation_mode='interest_only'`)**: o devedor paga só os juros por período e o principal (`remaining_balance`) fica em aberto por prazo indeterminado, até uma **quitação** (settlement). O **bot** ainda não usa esses parâmetros — só cria contratos parcelados padrão e baixa parcela via `markInstallmentPaid`.

Decisão de produto (confirmada): modelo **rotativo** — `bullet_principal_mode = null`, prazo indeterminado, `default_after_days = 20`, **sem** multa/quebra no MVP do bot. BOT-005 cobre **criação + baixa**.

## 2. Verificação de banco (read-only, guardião)

- `create_investment_validated(... p_calculation_mode text DEFAULT 'manual', p_bullet_principal_mode text DEFAULT NULL, p_default_after_days integer DEFAULT 20, ...)` — aceita `interest_only`.
- `pay_bullet_interest_only(p_installment_id uuid, p_paid_at timestamptz DEFAULT now(), p_payment_method text DEFAULT 'PIX', p_amount_paid numeric DEFAULT NULL)`:
  - `p_amount_paid` nulo/`< remaining_balance` → **rolagem**: marca a parcela paga (juros), gera a próxima parcela bullet, mantém `remaining_balance`.
  - `p_amount_paid >= remaining_balance` → **settlement**: quita juros + principal, zera `remaining_balance`, `investments.status = 'completed'`.
  - Rejeita se o contrato não for `interest_only`.
- Modelo financeiro (espelha `utils/financials.ts`): `installment_value = round(principal * taxa%)` (juros/período), `current_value = principal` (= `remaining_balance` inicial), `total_installments = 120` (sentinela usada pelo web para indeterminado).

## 3. Acceptance Criteria

### AC-1: Reconhecer intenção de bullet na criação
**Dado** que o admin descreve um empréstimo "só juros" / "juros simples" / "bullet" / "paga só os juros" / "principal em aberto"
**Quando** cria o contrato
**Então** o bot trata como `interest_only` e **não** pergunta a quantidade de parcelas (prazo indeterminado).

### AC-2: Slot-filling do bullet sem parcelas
**Dado** um bullet em criação
**Então** os slots são: nome → valor → taxa → CPF → frequência → (dia/dia-da-semana/data) — **sem** o slot `installments`.

### AC-3: Confirmação e comprovante bullet-aware
**Dado** um bullet pronto para confirmar
**Então** a mensagem mostra "Juros simples — prazo indeterminado", o **juros por período** (`principal × taxa%`) e o **principal em aberto**, **sem** total linear nem "Nx de".

### AC-4: Persistência atômica via RPC existente
**Quando** o admin confirma
**Então** o bot chama `create_investment_validated` com `p_calculation_mode:'interest_only'`, `p_bullet_principal_mode:null`, `p_default_after_days:20`, `p_total_installments:120`, `p_current_value = principal`, `p_installment_value = round(principal×taxa%)`. Sem update solto pós-RPC além do `asset_name` já existente.

### AC-5: Baixa bullet — escolha rolagem vs quitação
**Dado** que a parcela escolhida pertence a um contrato `interest_only`
**Quando** o admin confirma a baixa
**Então** o bot pergunta **"pagar juros"** (rolagem) ou **"quitar"** (settlement) e roteia para `pay_bullet_interest_only` com `p_amount_paid` nulo (rolagem) ou `= remaining_balance` (quitação).

### AC-6: Não regredir BOT-FIX-001
A guarda `awaitingCapabilityInput` (número de fluxo ativo não vira seleção de empresa) continua válida na baixa bullet.

## 4. Regras de negócio

- **BR-BOT-011 (bullet rotativo):** criação com `total_installments=120` sentinela; `current_value=principal`; `installment_value=round(principal×taxa%)`.
- **BR-BOT-012 (baixa bullet):** rolagem = `p_amount_paid` nulo; quitação = `p_amount_paid = remaining_balance` (lido do contrato). Léxico: "juros"/"rolar"/"só os juros" → rolagem; "quitar"/"liquidar"/"pagar tudo"/"principal" → settlement.

## 5. File List (planejado)

| Arquivo | Mudança |
|---------|---------|
| `e-finance-bot/src/actions/admin-actions.ts` | `ContractDraft.calculation_mode`; `createContract` ramo bullet; wrapper `payBulletInterest` |
| `e-finance-bot/src/assistant/executors/create-contract.ts` | input/zod + `extractCalculationMode` + `getMissingFields` (skip installments) + `toDraft` |
| `e-finance-bot/src/tools/formatters.ts` | confirmação + comprovante bullet-aware |
| `e-finance-bot/src/assistant/executors/mark-installment-paid.ts` | detecção bullet + escolha rolagem/quitação + roteamento `payBulletInterest` |
| `e-finance-bot/tests/evals/contract-flows.ts` | casos bullet (criação one-shot/slot, formatação, baixa rolagem/settlement, regressão empresa) |

## 6. QA Gate (@qa — 2026-05-30)

- [x] AC-1..AC-6 verificados (suíte determinística + ciclo live prod-like).
- [x] Gate determinístico: `tests/contract-flows.test.ts` **49/49** (41 prévios + 8 bullet); `npm test` **302 passed / 4 skipped**; `tsc --noEmit` exit 0.
- [x] Regressão BOT-FIX-001 (no-hijack) segue verde, inclusive sob bullet (`cap-mark_installment_paid-bullet-company-no-hijack`).
- [x] Ciclo live prod-like (`scripts/live-bullet-cycle.ts`, Gemini + Supabase reais, tenant descartável): **11/11 checks** — criação bullet por linguagem natural (`calculation_mode=interest_only`, `installment_value=500`, `remaining=5000`), rolagem (saldo mantém 5000, parcela paga, próxima gerada), quitação (`remaining=0`, `status=completed`).
- [x] Sem mudança de schema/RPC (uso read-only de RPC existente).

### Bug encontrado e corrigido no live (valor do teste prod-like)
O teste live revelou que as mensagens de escolha/preview exibiam **`installment.amount` (= `amount_total` = principal + juros = R$ 5.500)** como "juros da parcela", e a quitação somava R$ 10.500 — **erradas**. Os mocks usavam `amount=500`, então passavam; só o dado real expôs. **Correção:** `getInstallmentBulletInfo` passou a retornar `interestDue` (= `amount_interest − interest_payments_total`, espelhando o `v_interest_due` do RPC); os formatters de escolha/preview usam `interestDue` e a quitação soma `remaining + interestDue`. Regressão travada em `cap-mark_installment_paid-bullet-choice/rollover/settle` (assertam R$ 500 / R$ 5.500 e **excluem** R$ 10.500). Re-validado live: "Juros desta parcela: *R$ 500,00*", "Quitar… *R$ 5.500,00*".

- **Verdict:** ✅ **PASS** — pronto para `@devops *push` (push = deploy prod; aguardando autorização explícita do usuário).

## 7. Campanha de probes Haiku (QA contínuo)

3 subagentes Haiku isolados (report-only, sem commit, sem live), arquivos próprios em `tests/`:
- **probe-create** (`tests/probe-create.ts`, 38 casos, 100%): frequências × com/sem juros + bullet + parsing. Confirma BR-BOT-010/011.
- **probe-baixa** (`tests/probe-baixa.ts`, 20 casos, 19 pass + 1 soft): todas as formas de baixa; regressão BOT-FIX-001 verde. Achado: caso `falha_execução` é soft (asserção fraca) → TEST-001.
- **probe-view** (`tests/probe-view.ts`, 24 casos): dashboard/recebíveis/cobrança/relatório/saldo. (Relatório do agente continha uma alegação infundada de "AI-native/Claude API" — o arquivo de teste passa; descartada.)

Promoção ao gate permanente fica para TEST-001 (spec-driven).
