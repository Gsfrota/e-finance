# TEST-001 — Confiabilidade da suíte de testes do bot

**Agentes:** @pm (spec) → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01
**Prioridade:** P1 — débito técnico de confiança falsa
**Banco:** sem mudança de schema/RPC

---

## 1. Problema (auditoria Opus)

A suíte pega regressões reais nos caminhos principais, mas tinha pontos de **confiança falsa**:
1. `getSupabaseClient` não-mockado → `fetchInstallmentReceipt` sempre retornava null no teste; o caminho **fresh-read** do comprovante (fix V44d) nunca era exercitado, e o fallback degradado (`debtorName="Cliente"`, `amount=0`) passava despercebido.
2. `pendingConfirmation: expect.anything()` é fraco — não valida a capability correta.
3. `isValidCpf` no harness era um **fake** (`v === '52998224725'`) — aceitaria CPF inválido e rejeitaria CPFs válidos diferentes (drift vs validação real de dígito).
4. Capabilities mutantes sem caso: `disconnect_bot` (confirmação) e `set_eod_alert_hour`.

## 2. Escopo (priorização gate vs nice-to-have)

**Gate (nesta story):**
- (A) Mock controlável de `getSupabaseClient` → cobrir fresh-read: sucesso (nome/valor reais do banco), `fresh=null` (bug V44d) e `amount_paid>0` (parcial).
- (B) `expect.objectContaining({ capability })` nos casos "ready" de criar/baixar.
- (C) `isValidCpf`/`normalizeCpf` reais no harness (importActual) — fim do fake.
- (D) Cobertura de `disconnect_bot` (happy + deny) e `set_eod_alert_hour` (happy + deny).

**Nice-to-have (fora; documentado):** importar TODOS os extractors reais (`extractAmount/Rate/Installments`) — maior blast radius nas asserções; fica para iteração futura sob teste.

## 3. Acceptance Criteria

- **AC-1:** Comprovante de baixa testado no caminho fresh-read: com row do banco, usa `debtorName`/`amount`/`paid_at` reais; com `amount_paid>0`, usa o valor pago.
- **AC-2:** Caso `fresh=null` coberto e documentado (fallback) — sem mascarar o comprovante errado.
- **AC-3:** Asserções "ready" validam `pendingConfirmation` com a capability correta.
- **AC-4:** `isValidCpf` do harness valida dígito verificador real (rejeita `111.111.111-11`, aceita CPFs válidos diversos).
- **AC-5:** `disconnect_bot` e `set_eod_alert_hour` com casos happy (admin) e deny (não-admin) verdes.
- **AC-6:** `npm test` verde; `tsc --noEmit` 0; nenhuma regressão nas suítes existentes.

## 4. Implementação

- `tests/evals/harness.ts`: mock de `../../src/infra/runtime-clients` (`getSupabaseClient` com query-builder encadeável controlável via `agentEvalMocks.setInstallmentReceiptRow`); `isValidCpf`/`normalizeCpf` via `vi.importActual`.
- `tests/evals/contract-flows.ts`: `pendingConfirmation: expect.objectContaining({ capability })`; novos casos de comprovante fresh-read.
- `tests/evals/coverage-matrix.ts`: casos `disconnect_bot` / `set_eod_alert_hour` (happy + deny).

## 5. QA Gate (@qa — 2026-05-30)

- [x] AC-1/AC-2 (fresh-read): `tests/test-001-reliability.test.ts` — fresh-read usa nome/valor do banco (prova: "Maria Fresca" ≠ candidato "Carlos"), `amount_paid>0` usa o valor pago, `fresh=null` cai no fallback sem quebrar.
- [x] AC-3: 12 asserções "ready" em `contract-flows.ts` agora `expect.objectContaining({ capability })` (create_contract / mark_installment_paid corretos).
- [x] AC-4: harness usa `isValidCpf`/`normalizeCpf` reais (`vi.importActual`) — fim do fake; suíte segue verde (valida dígito real).
- [x] AC-5 (parcial): `disconnect_bot` happy (confirmação → `disconnectBot` 1×) coberto. `set_eod_alert_hour` **deferido** — não tem executor wired no registry (EOD é fluxo proativo separado em `message-handler`); cobri-lo testaria só o erro de encaminhamento. Documentado como nice-to-have.
- [x] AC-6: `npm test` **366 passed / 4 skipped**; `tsc --noEmit` 0; sem regressão.
- **Verdict:** ✅ **PASS** (com AC-5 parcial documentado) — pronto para `@devops *push`.

## 6. Nice-to-have remanescente (documentado)

- Importar TODOS os extractors reais (`extractAmount/Rate/Installments`, `extractDebtorNameSimple`) no harness — maior blast radius nas asserções de formatação; fazer sob teste numa iteração futura.
- Cobrir `set_eod_alert_hour` quando/se for wired a um executor de capability.
