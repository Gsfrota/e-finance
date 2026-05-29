# CB-007 — [FIX] Concerns pós-QA: interest_payments_total no settlement + guard investment undefined

**Agente:** @dev (impl) / @data-engineer (RPC) / @qa (gate) / @devops (push)
**Status:** Done
**Criada em:** 2026-05-29
**Origem:** QA gate CB-005/CB-006 — 2 concerns MEDIUM não-bloqueantes registrados
**Epic:** Caderneta Bullet (CB)
**Prioridade:** Média — correções de integridade de dados e robustez de UI

---

## 1. Problemas

### 1.A `interest_payments_total` não atualizado no settlement (RPC)

No caminho de settlement de `pay_bullet_interest_only`, o UPDATE em `loan_installments` **não atualiza** `interest_payments_total`:

```sql
-- Atual (settlement path):
UPDATE public.loan_installments SET
  amount_paid    = v_effective_amt,
  status         = 'paid',
  paid_at        = p_paid_at,
  payment_method = p_payment_method,
  updated_at     = NOW()
WHERE id = p_installment_id;
-- ↑ falta: interest_payments_total = COALESCE(...) + v_interest_due
```

O caminho de rolagem já atualiza corretamente. Inconsistência pode afetar relatórios de juros recebidos por parcela.

### 1.B `installment.investment` pode ser undefined (TypeScript)

Em `InstallmentDetailFlow.tsx:751`:
```typescript
if (installment.investment?.calculation_mode === 'interest_only') {
```

`investment?: Investment` é opcional em `LoanInstallment`. Se a query upstream não fizer join com `investments`, a condição retorna `false` silenciosamente e o contrato bullet vai para o path genérico (`pay_installment`) — não zera `remaining_balance`, não fecha o contrato.

**Contexto de risco:** CollectionDashboard ou futuros callers que carreguem parcelas sem o join de `investment`.

---

## 2. Solução especificada

### 2.A Fix no RPC (settlement path)

Adicionar `interest_payments_total` ao UPDATE da parcela no settlement:

```sql
UPDATE public.loan_installments SET
  amount_paid             = v_effective_amt,
  interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_due,  -- ← adicionar
  status                  = 'paid',
  paid_at                 = p_paid_at,
  payment_method          = p_payment_method,
  updated_at              = NOW()
WHERE id = p_installment_id;
```

### 2.B Guard no InstallmentDetailFlow

Em `handlePayStep1`, antes de checar `calculation_mode`, garantir que `investment` foi carregado. Se não estiver, buscar via Supabase antes de decidir o path:

```typescript
// Se investment não carregado, buscar para verificar calculation_mode
let calcMode = installment.investment?.calculation_mode;
if (!calcMode && installment.investment_id) {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('investments')
      .select('calculation_mode')
      .eq('id', installment.investment_id)
      .single();
    calcMode = data?.calculation_mode;
  }
}
if (calcMode === 'interest_only') {
  if (!(await checkStaleAndRefresh())) return;
  await submitBulletPayment(val);
  return;
}
```

---

## 3. Critérios de aceite

### AC-1: settlement atualiza interest_payments_total
**Dado** contrato bullet com parcela pendente `amount_interest = 50`
**Quando** admin quita via settlement
**Então** `loan_installments.interest_payments_total = 50` (antes era NULL ou 0 + não atualizado)

### AC-2: guard detecta bullet sem join
**Dado** installment bullet carregado sem join `investment` (`installment.investment === undefined`)
**Quando** `handlePayStep1` é chamado
**Então** o fetch de fallback detecta `calculation_mode = 'interest_only'` e roteia para `submitBulletPayment`

### AC-3: path genérico inalterado
**Dado** contrato não-bullet (auto/manual) com ou sem investment no join
**Então** path genérico (`submitPayment`) é usado normalmente

### AC-4: não-regressão: rolagem ainda funciona
**Dado** contrato bullet com pagamento só-juros
**Então** `interest_payments_total` continua sendo atualizado pelo path de rolagem (sem alteração)

---

## 4. Escopo

### IN
- `context/migration_cb007_fix_settlement_interest_total.sql` — UPDATE no settlement path do RPC
- `components/InstallmentDetailFlow.tsx` — guard de fallback para investment undefined

### OUT
- Schema audit_events / payment_transactions — não alterar
- Outros RPCs — sem alteração
- Contratos não-bullet — path genérico inalterado

---

## 5. Dependências

- **Requer:** CB-005 + CB-006 (aplicados em prod) ✓
- **Bloqueia:** nenhuma story

---

## 6. Complexidade e riscos

**Estimativa:** 2 pontos — cirúrgico, 1 arquivo SQL + 1 arquivo TS

**Riscos:**
- R1: Migration cria nova versão do RPC (DROP + CREATE com assinatura idêntica) — validar em BEGIN/ROLLBACK antes de aplicar em prod
- R2: Fallback fetch adiciona latência (~50ms) somente quando investment não está no join — aceitável

---

## 7. Arquivos-chave

- `context/migration_cb005_cb006_bullet_rpc_fix.sql` — RPC atual (base para o fix)
- `components/InstallmentDetailFlow.tsx:751` — ponto do guard

---

## 8. Definition of Done

- [x] `interest_payments_total` atualizado no settlement path (SQL validado em BEGIN/ROLLBACK)
- [x] Guard de fallback em `handlePayStep1` — busca `calculation_mode` se `investment` undefined
- [x] Build TypeScript sem erros
- [x] Migration aplicada em prod
- [x] @qa gate PASS

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @sm (River) | Story criada a partir de concerns MEDIUM do gate CB-005/CB-006 |
| 2026-05-29 | @po (Pax) | GO 10/10 — Draft → Ready. Nenhum bloqueio. |
| 2026-05-29 | @dev (Dex) | Implementado. CB-007-A: settlement path + `interest_payments_total`. CB-007-B: guard fallback fetch em `handlePayStep1`. Validado em BEGIN/ROLLBACK. Migration aplicada em prod. Build OK. |
| 2026-05-29 | @qa (Quinn) | PASS — 0 issues. AC-1 confirmado via BEGIN/ROLLBACK (interest_payments_total=150 após settlement). AC-2 guard code present. Regressão OK. |
