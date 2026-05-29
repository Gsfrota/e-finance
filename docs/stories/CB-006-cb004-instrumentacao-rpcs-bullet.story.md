# CB-006 — [BUG] Completar instrumentação CB-004: tipos bullet_* e audit_events nos RPCs

**Agente:** @data-engineer (RPC/migration) / @dev (client cleanup) / @qa (gate) / @devops (push)
**Status:** Ready for Review
**Criada em:** 2026-05-29
**Origem:** Smoke test CB-001..CB-004 em produção (2026-05-29) — CB-004 deployou schema mas não instrumentou os RPCs
**Epic:** Caderneta Bullet (CB)
**Prioridade:** Alta — auditoria transacional incompleta; cada pagamento bullet grava `transaction_type='payment'` genérico

---

## 1. Problema

O CB-004 deployou em produção:
- ✅ Tabela `audit_events` criada
- ✅ Tipos `bullet_*` adicionados ao CHECK de `payment_transactions`

Mas os RPCs **não foram instrumentados**. Evidência do smoke test (2026-05-29):

```sql
-- Após pagar só juros via pay_bullet_interest_only:
SELECT transaction_type, amount FROM payment_transactions WHERE investment_id = 3279;
-- → transaction_type = 'payment'  (deveria ser 'bullet_interest')

SELECT event_type FROM audit_events WHERE investment_id = 3279;
-- → bullet_contract_created, bullet_cycle_created  (rollover NÃO registrado)
```

A auditoria continua dependendo do cliente (fire-and-forget `logPaymentTransaction`), exatamente o problema que CB-004 foi criado para resolver.

---

## 2. Cobertura obrigatória (subconjunto prioritário)

Instrumentar os RPCs existentes que já estão em uso em produção. Seguir tabela da CB-004 §3:

| # | RPC | payment_transactions | audit_events |
|---|---|---|---|
| 4 | `pay_bullet_interest_only` — pagamento só juros/rolagem | `bullet_interest` | `bullet_rollover` |
| 3 | `pay_bullet_interest_only` — quando settlement (ver CB-005) | `bullet_settlement` | `bullet_settled` |
| 1 | `create_investment_validated` — já grava `bullet_contract_created` ✓ | — | já ok |
| 2 | `create_investment_validated` — já grava `bullet_cycle_created` ✓ | — | já ok |

Os demais eventos (multa, capitalização, renovação, reversão) entram em stories futuras conforme implementação funcional.

---

## 3. Spec de implementação

### 3.1 `pay_bullet_interest_only` — caminho de rolagem (só juros)

Dentro da mesma transação, após registrar o pagamento:

```sql
-- 1. Inserir em payment_transactions (substituir o INSERT genérico existente)
INSERT INTO payment_transactions (
  tenant_id, investment_id, installment_id,
  transaction_type, amount,
  principal_portion, interest_portion,
  payment_method, created_at
) VALUES (
  p_tenant_id, p_investment_id, p_installment_id,
  'bullet_interest', p_amount_paid,    -- ← tipo específico
  0, p_amount_paid,                     -- rolagem: 0 principal, 100% juros
  p_payment_method, now()
);

-- 2. Inserir em audit_events
INSERT INTO audit_events (
  tenant_id, investment_id, installment_id, payment_id,
  event_type, source, actor_user_id,
  before, after, value_breakdown
) VALUES (
  p_tenant_id, p_investment_id, p_installment_id, <payment_id_acima>,
  'bullet_rollover', 'rpc', p_actor_user_id,
  jsonb_build_object('remaining_balance', <saldo_antes>, 'installment_status', 'pending'),
  jsonb_build_object('remaining_balance', <saldo_depois>, 'installment_status', 'paid'),
  jsonb_build_object('interest', p_amount_paid, 'principal', 0)
);
```

### 3.2 `pay_bullet_interest_only` — caminho de settlement (CB-005)

Quando `p_amount_paid >= remaining_balance + interest`:

```sql
INSERT INTO payment_transactions (..., transaction_type, ...) 
VALUES (..., 'bullet_settlement', ...);

INSERT INTO audit_events (..., event_type, ...)
VALUES (..., 'bullet_settled', ...);
```

### 3.3 Remoção da duplicação client-side

Em `services/paymentAudit.ts` e `components/InstallmentDetailFlow.tsx`:
- Para chamadas a `pay_bullet_interest_only`, **remover** (ou guard por flag) a chamada a `logPaymentTransaction` após o RPC — auditoria já estará dentro do RPC.
- Manter `logPaymentTransaction` para contratos **não-bullet** (path genérico inalterado).

### 3.4 `p_actor_user_id` — passar o user_id autenticado

O RPC precisa receber o user_id para gravar em `audit_events.actor_user_id`. Se o RPC usa `auth.uid()` internamente (SECURITY DEFINER), verificar se `auth.uid()` está disponível. Se não, adicionar parâmetro `p_actor_user_id uuid DEFAULT auth.uid()`.

---

## 4. Critérios de aceite

### AC-1: Rolagem de juros grava tipo correto
**Dado** contrato bullet com parcela pendente
**Quando** admin paga só os juros via UI (ou RPC direto)
**Então:**
- `payment_transactions.transaction_type = 'bullet_interest'`
- `audit_events.event_type = 'bullet_rollover'` com `source = 'rpc'`
- `audit_events.before.remaining_balance` e `after.remaining_balance` corretos
- `audit_events.actor_user_id` = UUID do usuário autenticado (não NULL)

### AC-2: Settlement grava tipo correto (dependente de CB-005)
**Dado** contrato bullet em quitação
**Quando** admin paga valor total (principal + juros)
**Então:**
- `payment_transactions.transaction_type = 'bullet_settlement'`
- `audit_events.event_type = 'bullet_settled'`
- `audit_events.after.investment_status = 'completed'`

### AC-3: Sem duplicação de auditoria
**Dado** pagamento via `pay_bullet_interest_only`
**Então** apenas 1 linha em `payment_transactions` e 1 linha em `audit_events` por operação (sem duplo registro RPC + client).

### AC-4: Não-regressão contratos convencionais
**Dado** contrato `auto` ou `manual`
**Então** path genérico inalterado, `logPaymentTransaction` client-side continua funcionando.

### AC-5: Criação de contrato (já ok — confirmar regressão)
- `bullet_contract_created` e `bullet_cycle_created` continuam sendo gravados pelo `create_investment_validated`.

---

## 5. Escopo

### IN
- `context/migration_cb006_rpc_instrumentation.sql` — modificação do `pay_bullet_interest_only`
- `services/paymentAudit.ts` — remover/guard duplicação para bullet
- `components/InstallmentDetailFlow.tsx` — remover/guard `logPaymentTransaction` após bullet RPCs

### OUT
- `create_investment_validated` — não alterar (AC-1, AC-2 já ok)
- Outros eventos (multa, capitalização, renovação) — story futura
- Contratos não-bullet — sem alteração
- Schema `audit_events` / CHECK `payment_transactions` — já deployados, não alterar

---

## 6. Dependências

- **Requer:** CB-004 (schema deployado) ✓ — em prod desde 2026-05-29
- **Requer:** CB-005 (settlement fix) — para instrumentar caminho settlement. Pode ser implementado em paralelo; AC-2 desta story é condicional a CB-005 estar mergeado.
- **Bloqueia:** nenhuma story pendente

---

## 7. Complexidade e riscos

**Estimativa:** 3 pontos (modificação cirúrgica do RPC + cleanup client-side)

**Riscos:**
- R1: `auth.uid()` pode retornar NULL em context SECURITY DEFINER — testar antes de aplicar migration
- R2: Se o RPC usa `INSERT INTO payment_transactions` atualmente com tipo `'payment'`, a mudança para `'bullet_interest'` altera dados existentes de testes futuros (não retroativo)
- R3: Migration em prod deve ser testada em BEGIN/ROLLBACK primeiro (regra do guardião)

---

## 8. Arquivos-chave

- `context/migration_v35_fix_simple_interest.sql` — RPC `pay_bullet_interest_only` atual (base para modificação)
- `context/migration_cb004_audit_foundation.sql` — schema CB-004 (referência)
- `services/paymentAudit.ts` — `logPaymentTransaction` (linhas ~39)
- `components/InstallmentDetailFlow.tsx` — caller do RPC (linhas ~789-811)

---

## 9. Definition of Done

- [x] `payment_transactions.transaction_type = 'bullet_interest'` após rolagem de juros
- [x] `audit_events.event_type = 'bullet_rollover'` com before/after corretos
- [x] `payment_transactions.transaction_type = 'bullet_settlement'` após quitação (CB-005 mergeado junto)
- [x] Zero duplicação de linhas de auditoria por operação (logPaymentTransaction removido de handleInterest)
- [x] Build sem erros TypeScript
- [x] `npm run build` passa
- [ ] @qa gate PASS

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @sm (River) | Story criada a partir do smoke test CB prod |
| 2026-05-29 | @po (Pax) | GO 9/10 — status Draft → Ready. Atenção R1: verificar auth.uid() em SECURITY DEFINER antes da migration. AC-2 condicional a CB-005 mergeado (explicitado). |
| 2026-05-29 | @dev (Dex) | Implementado junto com CB-005 (mesmo RPC). R1 confirmado: auth.uid() NULL via service_role, funciona via authenticated (expected). Rolagem: INSERT bullet_interest + audit bullet_rollover. Settlement: INSERT bullet_settlement + audit bullet_settled. logPaymentTransaction removido de handleInterest. Validado via BEGIN/ROLLBACK. |
