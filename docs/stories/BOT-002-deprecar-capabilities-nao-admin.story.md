# BOT-002 — Deprecar capabilities não-admin (bot admin-only)

**Agentes:** @pm (spec/decisão) → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01
**Prioridade:** P1
**Banco:** sem mudança de schema/RPC

---

## 1. Problema

O bot é **admin-only**, mas os intents de autoatendimento não-admin
(`ver_minhas_parcelas`→`view_my_installments`, `ver_meu_saldo_devedor`→
`view_my_debt_summary`, `ver_meu_portfolio`→`view_my_portfolio`) ainda eram
roteados para capabilities de devedor/investidor — código vivo que não deve servir
ninguém num bot admin-only.

## 2. Decisão de produto: GATEAR (não remover)

Avaliado **remover vs gatear**. As capabilities `view_my_*` têm handlers AI-native
com **guardas de cross-tenant** e testes ativos (`tests/ai-native-realdata.test.ts`,
6 casos). Removê-las apagaria cobertura de segurança legítima e tocaria 8 arquivos
(tipo, registry, executor, planner, followup-resolver, tool-definitions, testes).

**Decisão:** **bloquear no caminho ativo (action-planner)** e **manter as
capabilities + testes como defense-in-depth** (caso o produto passe a suportar
autoatendimento, ou um não-admin seja linkado via AI-native no futuro).

## 3. Implementação

`src/assistant/action-planner.ts` — os 3 intents passam a rotear, **para qualquer
role**, ao equivalente admin; o `policy-engine` nega o não-admin nessas capabilities
admin-only (deny padrão), sem vazar dado de devedor/investidor:
- `ver_minhas_parcelas` → `list_receivables` (admin vê recebíveis; não-admin → deny).
- `ver_meu_saldo_devedor` → `show_dashboard` (já fazia p/ admin; agora incondicional).
- `ver_meu_portfolio` → `list_receivables` (idem).

As capabilities `view_my_*` permanecem no registry/executor/AI-native como
defense-in-depth (documentadas como deprecadas no caminho ativo).

## 4. Acceptance Criteria

- **AC-1:** Não-admin que envia "minhas parcelas / meu saldo / meu portfólio"
  recebe o **deny de policy** (não dado de devedor/investidor).
- **AC-2:** Admin mantém os atalhos: parcelas/portfólio → recebíveis; saldo → dashboard.
- **AC-3:** Matriz de deny atualizada (coverage-matrix): os 3 intents não-admin viram
  **deny verde** (eram happy-paths de devedor/investidor).
- **AC-4:** Handlers AI-native + testes de cross-tenant (`ai-native-realdata`) intactos.
- **AC-5:** `npm test` verde; `tsc` 0.

## 5. QA Gate (@qa — 2026-05-30)

- [x] AC-1: não-admin nos 3 intents → deny de policy (scorecard: `view_my_*` intents deny-verde, 0 fail/soft).
- [x] AC-2: admin mantém atalhos (parcelas/portfólio → list_receivables; saldo → dashboard).
- [x] AC-3: coverage-matrix — os 3 intents viram DENY_TARGETS (deny debtor+investor); happy-paths não-admin removidos.
- [x] AC-4: `ai-native-realdata.test.ts` (6) e handlers AI-native intactos.
- [x] AC-5: `npm test` **366 passed / 4 skipped**; `tsc` 0.
- **Verdict:** ✅ **PASS** — pronto para `@devops *push`.
