# CB-004 — [SPEC] Auditoria transacional obrigatória do fluxo Bullet

**Agente:** @architect / @data-engineer (schema/RPC) / @dev / @qa / @devops
**Status:** Draft — aguardando aprovação para implementar
**Criada em:** 2026-05-29
**Origem:** Requisito do usuário (2026-05-29): nenhuma mudança funcional no Bullet sem auditoria transacional obrigatória
**Bloqueia:** CB-003 (campos funcionais break fee / inadimplência só entram já auditados)
**Decisões de arquitetura (usuário, 2026-05-29):** (a) criar tabela `audit_events`; (b) adicionar tipos `bullet_*` à constraint de `payment_transactions`; (c) CB-004 bloqueia CB-003.

---

## 1. Problema (validado no schema/código real — 2026-05-29)

A auditoria do fluxo Bullet hoje é **não-transacional e frágil**:

- RPCs `pay_bullet_interest_only`, `process_bullet_payment`, `generate_next_bullet_installment` **não gravam nenhuma linha de auditoria** dentro da própria transação.
- A auditoria depende 100% do cliente: `InstallmentDetailFlow.tsx:1252` chama `logPaymentTransaction(...)` **após** o RPC, em conexão separada, **sem `await`** (fire-and-forget).
- `services/paymentAudit.ts:39`: `catch { /* non-critical — não bloqueia */ }` → **engole o erro em silêncio**.
- Consequência: um pagamento pode ser persistido **sem** linha de auditoria correspondente.

### Constraints reais do schema (via MCP, 2026-05-29)
- `payment_transactions.transaction_type` CHECK aceita apenas: `payment, avulso, surplus_applied, surplus_received, deferred, missed, reversal, late_auto`. **Não há tipos bullet_***.
- `audit_events` **não existe**.
- `tenant_events.user_id` é **NOT NULL** → não serve para eventos **sem ator** (cron de inadimplência/multa, `late_auto`). Faltam colunas para correlation_id, idempotency_key, before/after tipados.

---

## 2. Princípios (não-negociáveis)

1. **Toda mutação financeira crítica é auditada dentro da MESMA transação SQL/RPC.**
2. Logs client-side (`logPaymentTransaction`/`logEvent`) passam a ser **apenas complementares**, nunca a única fonte.
3. **Falha de auditoria em mutação crítica → bloqueia/rollback.** Sem `catch` silencioso.
4. Eventos financeiros (movimento de valor) → `payment_transactions` (com tipos `bullet_*`).
5. Eventos de domínio/debug → `audit_events` (before/after, ator nullable, correlation, idempotency, error).

---

## 3. Cobertura obrigatória (11 mutações)

| # | Mutação | payment_transactions | audit_events |
|---|---|---|---|
| 1 | Contrato Bullet criado | — | `bullet_contract_created` |
| 2 | Parcela/ciclo criado | — | `bullet_cycle_created` |
| 3 | Pagamento total / quitação | `bullet_settlement` | `bullet_settled` |
| 4 | Pagamento só juros / rolagem | `bullet_interest` | `bullet_rollover` |
| 5 | Pagamento parcial | `bullet_partial` | `bullet_partial_paid` |
| 6 | Inadimplência / default | — | `bullet_defaulted` |
| 7 | Multa aplicada | `bullet_fine` | `bullet_fine_applied` |
| 7b | Taxa de quebra aplicada | `bullet_break_fee` | `bullet_break_fee_applied` |
| 8 | Capitalização de juros | `bullet_capitalization` | `bullet_capitalized` |
| 9 | Renovação | — (usa `contract_renegotiations`) | `bullet_renewed` |
| 10 | Reversão | `reversal` (existente) | `bullet_reversed` |
| 11 | Erro / falha | — | `bullet_*_error` (ver §6) |

---

## 4. Schema proposto

### 4.1 `audit_events` (nova tabela)

```sql
CREATE TABLE public.audit_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id),
  event_type       text NOT NULL,                 -- ex: bullet_settled, bullet_defaulted
  source           text NOT NULL DEFAULT 'rpc',   -- rpc | cron | client | system
  actor_user_id    uuid NULL,                      -- NULL p/ cron/sistema
  company_id       uuid NULL,
  investment_id    bigint NULL,
  installment_id   uuid NULL,
  payment_id       uuid NULL,                      -- ref a payment_transactions.id quando houver
  correlation_id   uuid NULL,                      -- agrupa eventos de uma mesma operação
  idempotency_key  text NULL,                      -- evita duplicidade de operação
  before           jsonb NULL,
  after            jsonb NULL,
  value_breakdown  jsonb NULL,                      -- {principal, interest, fine, break_fee, ...}
  error_code       text NULL,
  error_message    text NULL
);
-- Índices: (tenant_id, created_at), (investment_id), (installment_id), (correlation_id)
-- UNIQUE parcial em (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
-- RLS: habilitar + policy de leitura por tenant (admin) — confirmar padrão das outras tabelas
```

### 4.2 Extensão da constraint de `payment_transactions`

```sql
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_transaction_type_check;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'payment','avulso','surplus_applied','surplus_received','deferred','missed','reversal','late_auto',
    'bullet_interest','bullet_settlement','bullet_partial','bullet_fine','bullet_break_fee','bullet_capitalization'
  ]));
```
> Additive: não invalida nenhuma linha existente (todos os 8 tipos atuais permanecem).

---

## 5. Padrão de auditoria nos RPCs

- Criar helper `public.log_audit_event(...)` (SECURITY DEFINER) que faz o INSERT em `audit_events`. Chamado **dentro** da transação do RPC.
- Cada RPC bullet (criação, pagamento, rolagem, parcial, capitalização) passa a:
  1. Executar a mutação;
  2. Inserir a(s) linha(s) financeira(s) em `payment_transactions` com tipo `bullet_*` (substitui o `logPaymentTransaction` client-side para esses fluxos);
  3. Inserir o evento de domínio em `audit_events` com before/after + breakdown + correlation_id.
- Como tudo está na mesma transação, falha em qualquer passo → rollback automático (princípio 3 atendido sem `catch` silencioso).
- Cron `update_overdue_installments` (G3/default): grava `audit_events` com `source='cron'`, `actor_user_id=NULL`.
- Cliente: `logPaymentTransaction` deixa de ser fonte primária; vira complemento opcional ou é removido nos fluxos cobertos. O `catch {}` silencioso deve ser eliminado onde a gravação for crítica.

---

## 6. Ponto de design em aberto — auditoria de ERRO/falha

Postgres **não tem transação autônoma nativa**: se o RPC dá rollback, um `audit_events` inserido dentro dele também reverte. Para auditar a **falha** de forma durável, opções:
- **(a)** Cliente registra o erro (complementar) — simples, mas fora da transação.
- **(b)** `dblink`/`pg_background` para escrever o erro em transação autônoma — robusto, mais complexo/infra.
- **(c)** Tabela de erros gravada por `EXCEPTION` block que re-levanta após logar via dblink.
> Decisão necessária na validação. Sucesso é sempre transacional; falha precisa desta escolha.

---

## 7. Escopo IN / OUT

**IN:** tabela `audit_events`; extensão da constraint; helper `log_audit_event`; instrumentar os RPCs bullet de criação/pagamento/rolagem/parcial/capitalização + cron; eliminar dependência exclusiva do client-side nos fluxos cobertos.

**OUT:** redesenhar fluxos não-bullet; remover `tenant_events` (permanece para auditoria de domínio geral); UI de visualização de auditoria (story futura).

---

## 8. Critérios de aceite

- [ ] `audit_events` criada com RLS e índices; `actor_user_id` nullable comprovado por evento de cron.
- [ ] Constraint de `payment_transactions` estendida sem invalidar linhas existentes.
- [ ] Cada uma das 11 mutações gera auditoria **na mesma transação** (provado por teste BEGIN/ROLLBACK contando linhas em `audit_events`/`payment_transactions`).
- [ ] Falha simulada de auditoria causa rollback da mutação (sem persistência parcial).
- [ ] `idempotency_key` evita duplicidade em reenvio.
- [ ] Decisão de auditoria de erro (§6) implementada conforme escolha.
- [ ] `npm run build` + `tsc` PASS; validação real via MCP.
- [ ] Só então CB-003 retoma os campos funcionais, já auditados.

---

## 9. Riscos

- **Alto:** instrumentar RPCs financeiros de produção — exige teste transacional rigoroso e guardião.
- **Médio:** mover auditoria do client para o RPC pode duplicar linhas se `logPaymentTransaction` não for removido nos fluxos cobertos → tratar com `idempotency_key`.
- **Médio:** RLS de `audit_events` mal configurada pode vazar/over-bloquear leitura.

---

## 10. Validação real executada (MCP — 2026-05-29)

- Constraint `payment_transactions.transaction_type`: 8 tipos, sem bullet_*.
- `audit_events` inexistente; `tenant_events.user_id` NOT NULL.
- RPCs bullet sem auditoria transacional; client `logPaymentTransaction` fire-and-forget + `catch {}` silencioso.
- Teste do redesign CB-003 (create_investment_validated 22→25 args) validado via BEGIN/ROLLBACK e revertido — não aplicado (aguarda auditoria embutida).

---

## 11. File list

Lidos/inspecionados: `components/InstallmentDetailFlow.tsx`, `components/InstallmentModals.tsx`, `services/paymentAudit.ts`, `components/AdminContracts.tsx`; schema/constraints/RPCs via MCP (`payment_transactions`, `tenant_events`, `create_investment_validated`, `process_bullet_payment`, `pay_bullet_interest_only`, `update_overdue_installments`).

Criados nesta etapa: `docs/stories/CB-004-auditoria-transacional-bullet.story.md`

---

## 12. Change Log

- **2026-05-29 — Decisões:** audit_events (nova tabela); tipos bullet_* na constraint; CB-004 bloqueia CB-003; auditoria de erro via dblink (transação autônoma).
- **2026-05-29 — Fundação aplicada** (migration `cb004_audit_foundation`, via guardião): `audit_events` (RLS por tenant, 6 índices, `idempotency_key` único parcial, `actor_user_id` nullable), constraint `payment_transactions` estendida com 6 tipos `bullet_*` (preserva os 8 atuais), helper `log_audit_event`. Validado via BEGIN/ROLLBACK antes do apply e confirmado pós-apply (tabela/RLS/índices/helper/constraint OK).
- **2026-05-29 — RPC criação instrumentado + deployado:** `create_investment_validated` grava `bullet_contract_created` + `bullet_cycle_created` (correlation_id, before/after, value_breakdown) na mesma transação. Aplicado em prod (migration `cb003_cb004_create_investment_validated_audited`) + frontend deployado (run `26616655035`). Verificado em prod via BEGIN/ROLLBACK.
- **2026-05-29 — pay_bullet_interest_only:** versão instrumentada (`bullet_interest` + `bullet_rollover`) VALIDADA via BEGIN/ROLLBACK, **NÃO aplicada** — coupling com `logPaymentTransaction` client-side geraria duplicação até o frontend dropar o log. Requer deploy coordenado (RPC + remoção do log client) — adiado deliberadamente (não fazer mudança acoplada de pagamento sem o usuário presente).
- **Pendentes:** error-path dblink (precisa credencial do role audit_writer — usuário fará); instrumentar process_bullet_payment, generate_next_bullet_installment, G3-cron, renovação, reversão (cada um com deploy coordenado RPC+frontend).
