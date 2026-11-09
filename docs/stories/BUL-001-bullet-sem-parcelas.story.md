# BUL-001 — Bullet não tem parcelas

**Status:** InReview · **Regra:** BR-CNT-013 · **Origem:** reclamação de cliente (bullets mostrando parcelas), RCA de 2026-11-08

## Causa raiz
1. `ContractDetail` trata os ciclos do bullet como parcelas ("X/Y parcelas pagas", "Parcela N").
2. `create_legacy_investment` (página "Contrato Antigo") gera N parcelas + linha de principal separada e não grava `remaining_balance`.
3. `mark_installment_missed` / `apply_remainder_action` / `defer_remaining_to_last` aceitam bullet e inserem linhas.
4. Carteira offline gera 1 ciclo no legado mas ignora `paid_count` de bullet.

## Acceptance Criteria
- [x] AC1 — `create_legacy_investment` bullet: `total_installments` e `bullet_principal_mode` NULL, `remaining_balance = principal`, `current_value = principal`, `paid_count` ciclos pagos + 1 aberto.
- [x] AC2 — As 3 RPCs de falta/adiamento recusam linha de bullet.
- [x] AC3 — `ContractDetail` e tela do ciclo (`InstallmentDetailFlow`) em bullet: resumo (saldo devedor, juros do ciclo, próximo vencimento, ciclos pagos) + "Histórico de ciclos"; sem X/Y nem %.
- [x] AC4 — `LegacyContractPage` em bullet: sem "N. de Parcelas" e sem modo "principal separado"; campo "Ciclos de juros já pagos".
- [x] AC5 — `InstallmentDetailFlow` / `InstallmentModals` não oferecem Falta nem adiamento de sobra em bullet.
- [x] AC6 — Carteira offline espelha AC1 e AC2.
- [x] AC7 — Saneamento dos contratos 520, 599, 632, 633, 1381, 3098 (migration v54, aprovada).

## File List
- docs/business-rules/e-finance-br.md
- context/migration_v54_bullet_sem_parcelas.sql
- components/ContractDetail.tsx
- components/LegacyContractPage.tsx
- components/InstallmentDetailFlow.tsx
- components/InstallmentModals.tsx
- packages/offline-finance/index.ts
- tests/unit/offlineFinance.test.ts

## Dev Notes / Verificação (2026-11-08)
- Migration v54 aplicada em prod após dry-run com rollback; guardas nas 3 RPCs, `create_legacy_investment` novo, 6 contratos saneados, 6 `audit_events` `bullet_data_fix`, 0 bullets com `total_installments`. GRANTs preservados.
- Smoke local (preview 4173, tenant QA): Contrato Antigo bullet com 2 ciclos pagos → banco 2 paid + 1 pending, `total_installments` null; detalhe sem "X/Y parcelas", 3 rótulos "Ciclo", sem botão "Não Recebido". Regressão: contrato parcelado #6067 mantém "Parcela"/"Total de parcelas"/"Não Recebido".
- `PaymentModal`: bullet não chama `apply_remainder_action` (evita pagamento gravado + erro).
- `npx tsc --noEmit` OK. `npm run test:unit` 378/379 — falha em `offlineClient.test.ts` ("imports a legacy receipt…", contrato `auto`), não atribuída a esta story mas não confirmada como pré-existente (pacote offline não versionado).
- Commit da BUL-001 leva só banco + telas; `packages/offline-finance` e `tests/unit/offlineFinance.test.ts` (AC6) entram junto com a OFF-001, que ainda não está versionada. `tsc` OK no tree do commit isolado.
