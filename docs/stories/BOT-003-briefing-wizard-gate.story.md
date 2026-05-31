# BOT-003 — Wizard do briefing vaza antes do gate de policy

**Agentes:** @pm → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01
**Prioridade:** P2
**Banco:** sem mudança de schema/RPC

---

## 1. Problema

`configure_briefing` é `rolesAllowed:['admin']` e o `policy-engine` bloqueia a
mutação para não-admin. Mas o **wizard** ("Me diga o horário do briefing…") é
disparado pela clarificação no `action-planner` *antes* do gate → para não-admin
vaza o prompt do wizard (sem efeito de escrita, severidade baixa). Documentado como
soft-fail em `coverage-matrix` (`configurar_briefing`).

## 2. Acceptance Criteria

- **AC-1:** Não-admin que pede "configurar briefing" recebe o **deny de policy**, não
  o wizard.
- **AC-2:** Admin mantém o fluxo: sem horário → wizard; com horário → executa.
- **AC-3:** O caso de `configurar_briefing` na coverage-matrix deixa de ser soft-fail
  e vira **deny verde**.

## 3. Implementação

`src/assistant/action-planner.ts`, case `configurar_briefing`: guard de role no
topo — se `role !== 'admin'`, retorna `execute configure_briefing` (o policy-engine
nega → deny padrão), **antes** da clarificação do wizard. Admin segue com o
wizard/execução normal.

## 4. QA Gate (@qa — 2026-05-30)

- [x] AC-1: não-admin em `configurar_briefing` → deny de policy (sem wizard). Scorecard: `configure_briefing` deixou de ser soft-fail.
- [x] AC-2: admin mantém wizard (sem horário) / execução (com horário).
- [x] AC-3: coverage-matrix — `configurar_briefing` movido de SOFT_DENY para DENY_TARGETS (deny verde).
- [x] `npm test` **366 passed / 4 skipped** (os 4 soft restantes = sensíveis create_contract/mark_installment_paid, por design); `tsc` 0.
- **Verdict:** ✅ **PASS** — pronto para `@devops *push`.
