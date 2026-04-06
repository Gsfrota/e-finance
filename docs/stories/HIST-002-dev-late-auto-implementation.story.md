# HIST-002 — [DEV] Implementar registro `late_auto` no cron e histórico

**Agente:** @dev  
**Status:** Done  
**BR:** BR-PAG-021  
**Criada em:** 2026-04-05  
**Depende de:** HIST-001 (definição visual UX) — apenas para a parte de frontend  
**Bloqueante para:** Nenhuma

---

## Contexto

Quando o cron `update_overdue_installments` marca parcelas como `late`, não há registro auditável. A BR-PAG-021 exige inserção em `payment_transactions` com `transaction_type = 'late_auto'` a cada transição `pending → late`.

O frontend (`InstallmentHistory.tsx`) deve exibir este evento como "Atrasada", distinto de "Falta registrada" (`missed`).

---

## Escopo

### Parte 1 — Banco (sem dependência de UX)

**Arquivo:** migration SQL nova (`context/migration_v39_late_auto_event.sql`)

Alterar a função `update_overdue_installments()` para inserir em `payment_transactions` após marcar como `late`:

```sql
CREATE OR REPLACE FUNCTION update_overdue_installments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Parcelas vencidas sem pagamento: pending → late
  UPDATE loan_installments
  SET status = 'late', updated_at = NOW()
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE
    AND (amount_paid IS NULL OR amount_paid < 0.01);

  -- 1b. Registrar evento late_auto para auditoria (BR-PAG-021)
  --     Idempotente: não duplicar se já existe registro para o mesmo installment_id
  INSERT INTO payment_transactions (
    installment_id, investment_id, tenant_id,
    transaction_type, amount, created_at
  )
  SELECT
    li.id, li.investment_id, li.tenant_id,
    'late_auto', 0, NOW()
  FROM loan_installments li
  WHERE li.status = 'late'
    AND li.updated_at >= NOW() - INTERVAL '1 minute'
    AND NOT EXISTS (
      SELECT 1 FROM payment_transactions pt
      WHERE pt.installment_id = li.id
        AND pt.transaction_type = 'late_auto'
    );

  -- 2. Parcelas com pagamento parcial ainda pending: pending → partial
  UPDATE loan_installments
  SET status = 'partial', updated_at = NOW()
  WHERE status = 'pending'
    AND amount_paid > 0.01
    AND amount_paid < amount_total - 0.01;

  -- 3. Parcelas renegociadas sem pagamento (data jogada pra frente): late → pending
  UPDATE loan_installments
  SET status = 'pending', updated_at = NOW()
  WHERE status = 'late'
    AND due_date >= CURRENT_DATE
    AND (amount_paid IS NULL OR amount_paid < 0.01);

  -- 4. Parcelas renegociadas COM pagamento parcial (data jogada pra frente): late → partial
  UPDATE loan_installments
  SET status = 'partial', updated_at = NOW()
  WHERE status = 'late'
    AND due_date >= CURRENT_DATE
    AND amount_paid > 0.01
    AND amount_paid < amount_total - 0.01;
END;
$$;
```

**Gate obrigatório (BR-PAG-019):** Antes de aplicar ao banco:
1. Inspecionar schema de `payment_transactions` para confirmar campos `installment_id`, `investment_id`, `tenant_id`, `transaction_type`, `amount`
2. Confirmar com usuário antes de aplicar migration
3. Validar após aplicação

### Parte 2 — Frontend (depende de HIST-001)

**Arquivo:** `components/InstallmentHistory.tsx`

Adicionar `late_auto` ao objeto `TX_META` (linha ~26) com icon/label/color definidos pela HIST-001:

```tsx
// Adicionar após 'missed':
late_auto: { icon: '<DEFINIR>', label: '<DEFINIR>', color: '<DEFINIR>' },
```

Verificar se a lógica de filtro da view "Por Recebimento" precisa excluir `late_auto` (eventos com `amount = 0` não são recebimentos).

---

## Critérios de Aceite

### Banco
- [ ] Migration v39 criada em `context/migration_v39_late_auto_event.sql`
- [ ] `update_overdue_installments` insere em `payment_transactions` com `transaction_type = 'late_auto'`
- [ ] Inserção é idempotente — rodar o cron 2x não cria duplicatas
- [ ] Migration aplicada ao Supabase e validada

### Frontend (após HIST-001)
- [ ] `TX_META.late_auto` adicionado com valores de HIST-001
- [ ] Evento aparece no histórico na view "Por Parcela"
- [ ] Exibição consistente com decisão UX sobre view "Por Recebimento"
- [ ] Evento exibe `amount = 0` acinzentado ou sem valor monetário (não confunde com recebimento)

### Não fazer
- [ ] Não alterar nenhuma RPC de pagamento (`pay_installment`, `apply_surplus_action`, etc.)
- [ ] Não alterar `mark_installment_missed`
- [ ] Não criar nova tabela — usar `payment_transactions` existente

---

## Gates de Segurança

**Gate DB obrigatório (e-finance-dev-workflow Step 5):**
- Inspecionar `payment_transactions` antes de escrever migration
- Confirmar com usuário antes de aplicar
- Validar após aplicação

**Gate Financeiro:**
- `amount = 0` — `late_auto` não move dinheiro, não afeta saldos
- `affects_balance = false` se o campo existir na tabela
