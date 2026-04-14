# Relatório de Auditoria — Fluxos de Pagamento

**Data:** 23/03/2026
**Escopo:** Todas as RPCs e fluxos de pagamento de parcelas (loan_installments)

---

## 1. Resumo Executivo

Foram executados **19 testes** cobrindo todos os fluxos de pagamento do sistema. **2 bugs críticos** foram encontrados e corrigidos na RPC `apply_surplus_action`. **1 contrato real de cliente** (Amanda, #497) foi afetado e corrigido.

### Alterações realizadas

| Tipo | Arquivo/Migration | Descrição |
|------|-------------------|-----------|
| Migration | `fix_apply_surplus_action_next_targets_after_current` | Corrige ação `next` para filtrar `number > v_src.number` |
| Migration | `fix_apply_surplus_spread_equal_distribution` | Corrige `spread` para distribuir igualmente entre parcelas |
| Novo serviço | `services/paymentAudit.ts` | `logPaymentTransaction` + `calcBreakdown` (compartilhado) |
| Frontend | `components/InstallmentDetailFlow.tsx` | Logging de auditoria em 5 fluxos de pagamento |
| Frontend | `components/InstallmentModals.tsx` | Importa do serviço compartilhado (elimina duplicação) |
| Frontend | `components/InstallmentHistory.tsx` | Ícones para `reversal` e `missed` na timeline |
| Tipos | `types.ts` | Adiciona `reversal` ao union `PaymentTransaction.transaction_type` |
| Dados | Contrato 497 (Amanda) | Swap parcelas #8/#17 (corrige efeito do bug) |

---

## ADENDO — Auditoria de 14/04/2026

**Data:** 14/04/2026
**Gatilho:** Reclamação de cliente (Leonice Bar / tenant MD Veículos) sobre excedente não aplicado conforme esperado + 5 falhas consecutivas no CI/CD (PAY-PARTIAL).

### BUG-1-v2: Regressão — `apply_surplus_action` 'next'/'spread' sem filtro `number > v_src.number`

- **Severidade:** CRÍTICA
- **Causa raiz:** Migration V35 (`migration_v35_fix_apply_surplus_action.sql`) reescreveu completamente a função preservando os 5 fixes (P1–P5) mas omitiu o filtro `AND number > v_src.number` que havia sido introduzido na V31 (correção original do BUG-1). Regressão silenciosa.
- **Confirmação em produção:** Log de reversão às 16:59:49 de 14/04/2026 registra textualmente `"surplus revertido na parcela #20; surplus revertido na parcela #11"` — parcela #11 < fonte #19, violação direta do BR-PAG-007.
- **Correção:** Migration V43 (`migration_v43_fix_apply_surplus_next_spread.sql`) aplicada em produção em 14/04/2026. Adiciona `AND number > v_src.number` em 3 pontos: query do `next`, query do `spread` passo-1 (soma), e query do `spread` passo-2 (loop).

### Contratos afetados (BUG-1-v2)

Scan via query forense em `loan_installments.notes` + `payment_transactions`:

| Contrato | Devedor | Status | Parcelas corrompidas | Outstanding gerado pelo bug | Situação |
|----------|---------|--------|---------------------|----------------------------|----------|
| 495 | Carlinho piscina | completed | #2, #8, #15, #16 (amount_total inflado) | R$ 0 (contrato encerrado) | Documentado, sem ação técnica necessária |
| 521 | Andreza manicure | active | #1 (R$6 crédito indevido de #11) | R$ 54 outstanding na #1 | **Pendente correção de dados** |
| 552 | Bruno moto taxi | active | #7 (R$5 crédito indevido de #11) | R$ 45 outstanding na #7 | **Pendente correção de dados** |
| 575 | Leonice Bar | completed | #11 e #20 (amount_total=R$90 cada, deveria ser R$30) | R$ 0 (contrato encerrado) | Documentado, sem ação técnica necessária |

> **Nota sobre 521 e 552:** A correção de dados das parcelas corrompidas (#1 e #7) foi adiada a pedido do proprietário do tenant. Aplicar quando conveniente via:
> ```sql
> -- Investment 521 (#1):
> UPDATE loan_installments SET amount_paid=0, status='pending',
>   notes='Correção BUG-1 V35 (2026-04-14): excedente de #11 aplicado indevidamente'
> WHERE investment_id=521 AND number=1;
>
> -- Investment 552 (#7):
> UPDATE loan_installments SET amount_paid=0, status='late',
>   notes='Correção BUG-1 V35 (2026-04-14): excedente de #11 aplicado indevidamente'
> WHERE investment_id=552 AND number=7;
> ```

### BUG-E2E-1: PAY-PARTIAL — race condition + fallback silencioso

- **Severidade:** BLOCKER CI/CD (5 runs falhando desde 13/04/2026)
- **Causa raiz 1:** `waitFor({timeout:10_000}).catch(()=>{})` engolia timeout silenciosamente. Se a tabela não re-renderizou após `switchToAllPeriods`, `openPaymentModal` caía no fallback "primeira BAIXA visível" e pagava a parcela errada. `fetchInstallment(inst.id)` lia `amount_paid=0` pois ninguém havia pago aquela parcela.
- **Causa raiz 2:** `fetchInstallment` era chamado imediatamente após UI mostrar "Confirmado", sem aguardar o commit do PostgREST. Latência de rede causava leitura de estado stale (`status=pending, amount_paid=0`).
- **Correção (`e2e/payment/installment-payment.spec.ts`, commit ae56b45):**
  - `waitFor` sem `.catch()` — falha explícita se parcela não aparecer na tabela
  - `expect.poll()` com timeout 5s no `fetchInstallment` para tolerar latência PostgREST

### Migrations aplicadas neste adendo

| Migration | Data | Descrição |
|-----------|------|-----------|
| `v43_fix_apply_surplus_next_spread` | 14/04/2026 | Corrige regressão BUG-1 em V35 — 3 ocorrências de `AND number > v_src.number` |

---

## 2. Bugs Encontrados e Corrigidos

### BUG-1: `apply_surplus_action` — ação `next` aplicava no destino errado

- **Severidade:** ALTA
- **Causa raiz:** Query usava `ORDER BY number ASC` sem `WHERE number > v_src.number`, selecionando a primeira parcela pendente/late/partial do contrato inteiro, não a próxima após a atual.
- **Impacto:** Excedente era enviado para parcelas *anteriores* à parcela paga. O frontend mostrava "descontado da parcela #17" mas a RPC aplicava na #8.
- **Dados reais afetados:** Contrato 497 (Amanda) — parcela #8 foi quitada indevidamente, #17 ficou pendente.
- **Correção:** Adicionado `AND number > v_src.number` nas ações `next` e `spread`.
- **Correção de dados:** Swap manual (#8 volta a `late`, #17 marcada `paid`).

### BUG-2: `apply_surplus_action` — ação `spread` fazia redução sequencial

- **Severidade:** MÉDIA
- **Causa raiz:** Loop aplicava todo o surplus na primeira parcela e definia `v_remaining := 0`, ao invés de dividir igualmente.
- **Impacto:** Frontend exibia "R$150 de desconto em cada parcela" mas a RPC colocava R$300 inteiros na primeira. O cliente via informação diferente do que aconteceu.
- **Dados reais afetados:** Nenhum encontrado (spread pouco usado na produção).
- **Correção:** Calcula `v_per_inst := ROUND(p_surplus_amount / v_count, 2)` e distribui igualmente, com ajuste de arredondamento na última parcela.

---

## 3. Resultados dos Testes

### Bateria 1 — Fluxos principais (contrato TEST-AUDIT-001)

| # | Cenário | RPC Testada | Resultado |
|---|---------|-------------|-----------|
| T1 | Pagamento exato (R$1100) | `pay_installment` | ✅ PASS |
| T2 | Pagamento parcial R$700 + remainder → next | `pay_installment` + `apply_remainder_action` | ✅ PASS |
| T3 | Pagamento com multa + juros mora (R$1577) | `pay_installment` | ✅ PASS |
| T4 | Excedente R$300 → next | `apply_surplus_action(next)` | ❌→✅ BUG corrigido |
| T5 | Excedente R$200 → last | `apply_surplus_action(last)` | ✅ PASS |
| T6 | Excedente R$300 → spread (2 parcelas) | `apply_surplus_action(spread)` | ❌→✅ BUG corrigido |
| T7a | Registrar falta → defer last | `mark_installment_missed` | ✅ PASS |
| T7b | Reversão de pagamento | UPDATE direto | ✅ PASS |
| T8 | Surplus > outstanding (quita destino inteiro) | `apply_surplus_action(next)` | ✅ PASS |
| T9 | Pay_late (surplus → parcelas atrasadas) | `pay_installment` (loop) | ✅ PASS |

### Bateria 2 — Edge cases e fluxos adicionais (contrato TEST-AUDIT-002)

| # | Cenário | RPC Testada | Resultado |
|---|---------|-------------|-----------|
| T10 | 2 pagamentos parciais acumulados (R$400+R$300) | `pay_installment` x2 | ✅ PASS |
| T11 | Completar parcela parcial (R$400 restantes) | `pay_installment` | ✅ PASS |
| T12 | Valor > outstanding (R$5000 → clamp R$1100) | `pay_installment` | ✅ PASS |
| T13 | Remainder com juros 5% (R$500→R$525 na próxima) | `apply_remainder_action(next, 5)` | ✅ PASS |
| T14 | Remainder → new (cria parcela #16) | `apply_remainder_action(new)` | ✅ PASS |
| T15 | Refinance (pagar R$300, nova data) | `refinance_installment` | ✅ PASS |
| T16a | Registrar falta → postpone | `mark_installment_missed(postpone)` | ✅ PASS |
| T16b | Pagar parcela com missed_at | `pay_installment` | ✅ PASS |
| T18 | Pagamento com valor=0 (erro esperado) | `pay_installment` | ✅ PASS |
| T19 | Surplus → next em parcela alta do contrato | `apply_surplus_action(next)` | ✅ PASS |

---

## 4. Auditoria de Dados Reais

### Verificação de inversões em contratos de clientes (auditoria 23/03/2026)

Todos os contratos com notas de excedente foram analisados:

| Contrato | Asset | Inversão? | Ação |
|----------|-------|-----------|------|
| 478 | Contrato Raimundo | ✅ OK (direção correta) | Nenhuma |
| 481 | Todo dias pb | ⚠️ #3←#6 | **Intencional** (fluxo pay_late) |
| 495 | Contrato Carlinho | ✅ OK (direção correta) | Nenhuma |
| 497 | Contrato Amanda | ❌ #8←#16 (deveria ser #17) | **Corrigido**: swap #8/#17 |
| 499 | teste 1 | ✅ OK | Nenhuma |
| 508 | 1000 | ✅ OK | Nenhuma |

### Verificação de inversões — re-scan 14/04/2026 (após detecção BUG-1-v2)

| Contrato | Devedor | Parcela | Fonte | Tipo | Ação |
|----------|---------|---------|-------|------|------|
| 495 | Carlinho piscina | #2, #8, #15, #16 ← #21 | #21 | ❌ BUG-1-v2 (spread sem filtro) | Completed — documentado |
| 521 | Andreza manicure | #1 ← #11 | #11 | ❌ BUG-1-v2 | Active — **pendente correção** |
| 552 | Bruno moto taxi | #7 ← #11 | #11 | ❌ BUG-1-v2 | Active — **pendente correção** |
| 575 | Leonice Bar | #11 ← #19 | #19 | ❌ BUG-1-v2 | Completed — documentado |

### Correção aplicada — Contrato 497 (Amanda)

```
ANTES (bug):  #16 paga → surplus quitou #8 (errado)  → #17 ficou late
DEPOIS (fix): #16 paga → surplus quitou #17 (correto) → #8 voltou a late
```

Notas de auditoria foram adicionadas nas parcelas corrigidas para rastreabilidade.

---

## 5. Logging de Auditoria (payment_transactions)

### Cobertura por fluxo no InstallmentDetailFlow.tsx

| Fluxo | Função | Tipos de transação gravados |
|-------|--------|-----------------------------|
| Pagamento exato | `submitPayment` | `payment` |
| Pagamento parcial | `submitPayment` | `payment` + `deferred` |
| Excedente → atrasadas | `handlePaySurplusStep` (pay_late) | `payment` + `surplus_applied` + `surplus_received` (cada atrasada) |
| Excedente → next/last/spread | `handlePaySurplusStep` | `payment` + `surplus_applied` |
| Registrar falta | `handleMiss` | `missed` |
| Reverter pagamento | `handleUnpay` | `reversal` |

### Breakdown proporcional

Cada transação tipo `payment` inclui `principal_portion`, `interest_portion`, `extras_portion` calculados proporcionalmente ao obligation total da parcela (principal + juros + multa + juros_mora).

---

## 6. RPCs Auditadas

| RPC | Função | Status |
|-----|--------|--------|
| `pay_installment` | Paga valor na parcela, clamp se > outstanding | ✅ OK |
| `apply_surplus_action` | Aplica excedente (next/last/spread) | ✅ Corrigida (2 bugs) |
| `apply_remainder_action` | Destina saldo restante (next/last/new) com juros | ✅ OK |
| `mark_installment_missed` | Registra falta (postpone/last/new) | ✅ OK |
| `refinance_installment` | Renegociação (pagamento parcial + nova data) | ✅ OK |

---

## 7. Arquitetura do Serviço de Auditoria

```
services/paymentAudit.ts
├── logPaymentTransaction()  — grava em payment_transactions (non-blocking)
└── calcBreakdown()          — calcula proporção principal/juros/extras

components/InstallmentDetailFlow.tsx  → importa logPaymentTransaction, calcBreakdown
components/InstallmentModals.tsx      → importa logPaymentTransaction, calcBreakdown
components/InstallmentHistory.tsx     → exibe timeline de payment_transactions
```

Tabela `payment_transactions` possui RLS habilitada, com campos:
`id, tenant_id, investment_id, installment_id, transaction_type, amount, principal_portion, interest_portion, extras_portion, related_installment_id, related_installment_number, payment_method, notes, created_at`
