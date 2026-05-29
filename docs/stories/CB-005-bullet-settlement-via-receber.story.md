# CB-005 — [BUG] Bullet: "Receber" não fecha contrato interest_only (remaining_balance não zera)

**Agente:** @dev (impl UI + RPC) / @data-engineer (RPC se necessário) / @qa (gate) / @devops (push)
**Status:** Ready for Review
**Criada em:** 2026-05-29
**Origem:** Smoke test CB-001..CB-004 em produção (2026-05-29) — bug confirmado com evidência de banco
**Epic:** Caderneta Bullet (CB)
**Prioridade:** Alta — bloqueia quitação de contratos bullet em produção

---

## 1. Problema

O botão **"Receber"** no `InstallmentDetailScreen` para contratos `interest_only` usa o path genérico (`type='pay'`), que chama `logPaymentTransaction` client-side e marca a parcela como `paid` — mas **não chama** `pay_bullet_interest_only`.

Resultado (confirmado no smoke test via MCP):
- Parcela fica `status=paid`, `amount_paid=550` ✓
- **`investments.remaining_balance` permanece 500** (não zera) ✗
- **`investments.status` permanece `active`** (não vira `completed`) ✗
- Contrato bullet nunca encerra pelo caminho normal da UI

### Evidência do banco (smoke test 2026-05-29)
```
investment #3279: remaining_balance=500, status=active (após pagar parcela 2 de R$550 via "Receber")
payment_transactions: transaction_type='payment' (genérico, não 'bullet_settlement')
audit_events: nenhum evento de settlement
```

### Root cause
`InstallmentDetailFlow.tsx` — botão "Receber" → `onAction({ type: 'pay' })` → path genérico.
Para `interest_only`, esse path não é suficiente: a lógica de settlement (zerar saldo, fechar contrato, gerar `bullet_settlement`) está exclusivamente no RPC `pay_bullet_interest_only`.

---

## 2. Solução especificada

### 2.1 Regra de routing no `InstallmentDetailScreen`

Quando `investment.calculation_mode === 'interest_only'` **e** a parcela ainda não está paga (`!isPaid`):

| Ação do usuário | Valor a pagar | Routing |
|---|---|---|
| Clica **"Só o Juros"** | `amount_interest` (só juros) | → `pay_bullet_interest_only` (já implementado) |
| Clica **"Receber"** | `amount_total` (principal + juros = quitação) | → `pay_bullet_interest_only` com `p_amount = amount_total` |

O `pay_bullet_interest_only` já existe e deve detectar `p_amount >= remaining_balance` para realizar o settlement. Se ainda não detecta, o RPC precisa dessa lógica (ver §2.2).

### 2.2 Ajuste no RPC `pay_bullet_interest_only` (se necessário)

O RPC deve verificar: se `p_amount_paid >= p_remaining_balance` (ou `>= amount_total da parcela`):
1. Marcar parcela como `paid`
2. Setar `investments.remaining_balance = 0`
3. Setar `investments.status = 'completed'`
4. **Não gerar** nova parcela (contrato encerrado)
5. Registrar `transaction_type = 'bullet_settlement'` em `payment_transactions` (dentro da transação)
6. Registrar `event_type = 'bullet_settled'` em `audit_events` (dentro da transação)

Se `p_amount_paid < p_remaining_balance + interest` (pagamento parcial de saldo):
- Comportamento atual de rolagem se mantém (gera nova parcela com remaining_balance reduzido)

### 2.3 Ajuste na UI (`InstallmentDetailFlow.tsx`)

No `handlePayment` (ou equivalente), quando `investment.calculation_mode === 'interest_only'` e `action.type === 'pay'`:

```typescript
// Ao invés do path genérico, chamar:
await supabase.rpc('pay_bullet_interest_only', {
  p_installment_id: installment.id,
  p_amount_paid: formData.amount,  // amount_total da parcela
  p_payment_method: formData.payment_method,
});
```

Remover (ou condicionar) a chamada a `logPaymentTransaction` client-side para `interest_only` — a auditoria já ocorrerá dentro do RPC (CB-006).

---

## 3. Critérios de aceite

### AC-1: Settlement via "Receber" fecha o contrato
**Dado** um contrato `interest_only` ativo com `remaining_balance = R$ 500` e parcela pendente `amount_total = R$ 550`
**Quando** o admin clica "Receber" e confirma sem alterar o valor
**Então:**
- `investments.remaining_balance = 0`
- `investments.status = 'completed'`
- `loan_installments.status = 'paid'`, `amount_paid = 550`
- Nenhuma nova parcela gerada
- `payment_transactions.transaction_type = 'bullet_settlement'`

### AC-2: "Só o Juros" continua funcionando (não-regressão)
**Dado** o mesmo contrato
**Quando** o admin clica "Só o Juros — R$ 50,00" e confirma
**Então:**
- `remaining_balance` permanece 500
- Parcela 1 fica `paid`, `amount_paid = 50`
- Nova parcela 2 gerada
- `payment_transactions.transaction_type = 'bullet_interest'`

### AC-3: Valor editável no form "Receber" para bullet
**Dado** o form aberto via "Receber"
**Quando** o admin edita o valor para R$ 50 (só juros)
**Então** o comportamento é o mesmo que "Só o Juros" (rolagem, não settlement)

### AC-4: Botão "Receber" tem label diferenciado para bullet (opcional)
Para evitar confusão, `interest_only`: "Receber" pode exibir "Quitar Contrato" ou tooltip indicando quitação total.
*(Não-bloqueante — implementar se não adicionar complexidade)*

---

## 4. Escopo

### IN
- `components/InstallmentDetailFlow.tsx` — routing do `type='pay'` para bullet
- `context/migration_vXX_bullet_settlement_fix.sql` — ajuste no `pay_bullet_interest_only` se RPC não detecta settlement
- `services/paymentAudit.ts` — remover/condicionar `logPaymentTransaction` duplicado para `interest_only`

### OUT
- Contratos não-bullet (`auto`, `manual`) — sem alteração no path genérico
- UI do formulário de pagamento (layout, campos) — não mudar
- CB-006 (instrumentação completa CB-004) — story separada

---

## 5. Dependências

- **Requer:** CB-001, CB-002, CB-003 (todos em prod) ✓
- **Requer:** `audit_events` e tipos `bullet_*` em `payment_transactions` em prod ✓ (deployados em CB-004)
- **Bloqueia:** nenhuma story pendente

---

## 6. Complexidade e riscos

**Estimativa:** 3 pontos (mudança cirúrgica em 1-2 arquivos + ajuste RPC)

**Riscos:**
- R1: RPC `pay_bullet_interest_only` pode não ter lógica de settlement → verificar antes de codificar
- R2: Pagamentos parciais (ex: R$ 300 de R$ 550) — definir comportamento: redução de saldo ou erro?
  - **Decisão do guardião (a confirmar):** parcial = redução de remaining_balance (rolagem com saldo menor)
- R3: Regressão no path "Só o Juros" — cobrir com AC-2

---

## 7. Arquivos-chave

- `components/InstallmentDetailFlow.tsx` — handler `pay`, botão "Receber"
- `context/migration_v35_fix_simple_interest.sql` — RPC `pay_bullet_interest_only` atual
- `services/paymentAudit.ts` — `logPaymentTransaction`
- `types.ts` — `Investment.calculation_mode`

---

## 8. Definition of Done

- [x] `remaining_balance = 0` e `status = 'completed'` após "Receber" em contrato bullet
- [x] `transaction_type = 'bullet_settlement'` gravado dentro do RPC
- [x] "Só o Juros" não-regressão validado (BEGIN/ROLLBACK)
- [x] Build sem erros TypeScript
- [x] @qa gate PASS (CONCERNS — ver QA Results)

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @sm (River) | Story criada a partir do smoke test CB prod |
| 2026-05-29 | @po (Pax) | GO 9/10 — status Draft → Ready. AC-3 marcado opcional: @dev decide se "Receber" aceita valor editável ou é fixo em amount_total para bullet. |
| 2026-05-29 | @dev (Dex) | Implementado. RPC: DROP+CREATE com p_amount_paid NUMERIC DEFAULT NULL. Settlement quando p_amount_paid >= remaining_balance. Client: submitBulletPayment em handlePayStep1. CB-006: bullet_interest/bullet_settlement em payment_transactions + audit_events dentro do RPC. logPaymentTransaction removido de handleInterest. Validado em BEGIN/ROLLBACK. Build OK. |
