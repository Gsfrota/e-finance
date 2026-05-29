# Relatório de Validação — Schema Real e Dados Legados Bullet (CB-002)

## 1. Conexão MCP/Projeto

| Item | Valor |
|------|-------|
| **Horário servidor** | 2026-05-28 21:38:07 UTC |
| **Banco** | `postgres` |
| **Versão PostgreSQL** | 17.6 (aarch64-unknown-linux-gnu, GCC 13.2.0) |
| **Conexão MCP** | Ativa, read-only confirmada |

---

## 2. Schema Real

### 2.1 `investments` — colunas relevantes

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| `calculation_mode` | text | YES | `'auto'` |
| `bullet_principal_mode` | text | YES | NULL ← CHECK: `NULL \| 'together' \| 'separate'` |
| `remaining_balance` | numeric | YES | NULL |
| `capitalize_interest` | boolean | YES | `true` |
| `parent_investment_id` | bigint | YES | NULL |
| `status` | text | YES | `'active'` |
| `interest_rate` | numeric | YES | `0` |
| `source_capital` | numeric | NO | `0` |
| `source_profit` | numeric | NO | `0` |
| `frequency` | text | YES | `'monthly'` ← CHECK: monthly/weekly/daily/freelancer/irregular |

**Colunas AUSENTES (todas necessárias para CB-002):**

| Coluna esperada | Status |
|-----------------|--------|
| `default_after_days` | ❌ AUSENTE |
| `grace_days` | ❌ AUSENTE |
| `break_fee_amount` | ❌ AUSENTE |
| `break_fee_rate` | ❌ AUSENTE |
| `break_fee_type` | ❌ AUSENTE |
| `metadata` (jsonb) | ❌ AUSENTE |
| `renewal_allowed` | ❌ AUSENTE |
| `renewal_count` | ❌ AUSENTE |

### 2.2 `loan_installments` — colunas relevantes

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| `amount_principal` | numeric | NO | `0` |
| `amount_interest` | numeric | NO | `0` |
| `amount_total` | numeric | NO | — |
| `amount_paid` | numeric | YES | `0` |
| `fine_amount` | numeric | YES | `0` |
| `interest_delay_amount` | numeric | YES | `0` |
| `interest_payments_total` | numeric | YES | `0` |
| `status` | text | YES | `'pending'` |
| `deferred_from_id` | uuid | YES | NULL |
| `missed_at` | timestamptz | YES | NULL |

**Colunas AUSENTES em `loan_installments`:**

| Coluna esperada | Status |
|-----------------|--------|
| `cycle_number` | ❌ AUSENTE |
| `capitalized_amount` | ❌ AUSENTE |
| `rollover_from_id` | ❌ AUSENTE |
| `is_bullet_cycle` | ❌ AUSENTE |
| `break_fee_amount` | ❌ AUSENTE |
| `metadata` (jsonb) | ❌ AUSENTE |
| `extras_portion` | ❌ AUSENTE (existe em `payment_transactions`) |
| `principal_portion` | ❌ AUSENTE (existe em `payment_transactions`) |
| `interest_portion` | ❌ AUSENTE (existe em `payment_transactions`) |

### 2.3 `payment_transactions` — colunas relevantes

Todas as colunas de portioning já existem: `principal_portion` numeric(YES,0), `interest_portion` numeric(YES,0), `extras_portion` numeric(YES,0).

**Tipos de transação permitidos (CHECK constraint):**
`payment | avulso | surplus_applied | surplus_received | deferred | missed | reversal | late_auto`

> ⚠️ Novos tipos como `bullet_rollover` ou `bullet_cycle_close` precisarão ser adicionados ao CHECK.

### 2.4 Enums e Constraints notáveis

| Enum/CHECK | Valores |
|-----------|---------|
| `installment_status` (pg enum) | `pending, paid, late, partial` |
| `contract_frequency` (pg enum) | `monthly, weekly, daily, freelancer` |
| `chk_bullet_principal_mode` | `NULL \| 'together' \| 'separate'` |
| `check_source_sum` | `abs((source_capital + source_profit) - amount_invested) < 0.01` ← **risco de capitalização** |
| `investments_frequency_check` | text CHECK duplicado do enum (inclui `irregular`) |

---

## 3. RPCs — Assinaturas Reais

### Existentes

| Função | Assinatura | SECURITY DEFINER | Volatility |
|--------|-----------|-----------------|------------|
| `create_investment_validated` | `(p_tenant_id, p_user_id, p_payer_id, p_asset_name, p_amount_invested, p_source_capital, p_source_profit, p_current_value, p_interest_rate, p_installment_value, p_total_installments, p_frequency, p_due_day, p_weekday, p_start_date, p_calculation_mode, p_skip_saturday, p_skip_sunday, p_custom_dates date[], p_company_id, p_bullet_principal_mode, p_capitalize_interest) → bigint` | ✅ | VOLATILE |
| `create_legacy_investment` | `(..., p_bullet_principal_mode) → bigint` | ✅ | VOLATILE |
| `generate_next_bullet_installment` | `(p_investment_id bigint) → uuid` | ✅ | VOLATILE |
| `pay_bullet_interest_only` | `(p_installment_id uuid, p_paid_at timestamptz, p_payment_method text) → json` | ✅ | VOLATILE |
| `process_bullet_payment` | `(p_installment_id uuid, p_amount numeric, p_paid_at timestamptz, p_payment_method text) → json` | ✅ | VOLATILE |

### Ausentes (necessárias para CB-002)

| Função | Status |
|--------|--------|
| `process_bullet_cycle_payment` | ❌ AUSENTE |
| `process_bullet_cycle` | ❌ AUSENTE |

### Lógica das RPCs (comportamento real)

**`create_investment_validated`** — para `calculation_mode='interest_only'`:
- Seta `bullet_principal_mode = NULL` (ignora o parâmetro para bullets!)
- Seta `remaining_balance = p_amount_invested`
- Seta `capitalize_interest = p_capitalize_interest`
- Cria a **primeira parcela** com `amount_principal = remaining_balance`, `amount_interest = juros do ciclo`

**`generate_next_bullet_installment`** — guardrail embutido: se já existe parcela `pending`, retorna ela sem criar nova (cobertura parcial — ver anomalia §4.5).

**`pay_bullet_interest_only`** — marca parcela como `status='paid'` com `amount_paid = apenas_juros < amount_total`. **Comportamento deliberado de rolagem**, mas cria inconsistência semântica: `paid` não significa quitação total.

**`process_bullet_payment`** — fluxo completo:
1. Prioriza quitação de juros, depois principal
2. Atualiza `remaining_balance`
3. Marca contrato `completed` se `remaining_balance <= 0.01`
4. Se `capitalize_interest=TRUE` e houve juros não pagos após fechar parcela → capitaliza no `remaining_balance`
5. Gera próxima parcela via `generate_next_bullet_installment`

**`create_legacy_investment`** — **não aceita `p_capitalize_interest`** (parâmetro ausente na assinatura).

---

## 4. Dados Legados

### 4.1 Distribuição de contratos `interest_only` (total: **27 ativos**)

| `bullet_principal_mode` | `capitalize_interest` | `status` | Qtd |
|------------------------|----------------------|----------|-----|
| **NULL** | true | active | **20** (74%) |
| **NULL** | false | active | 3 (11%) |
| `separate` | true | active | 2 |
| `together` | true | active | 2 |

> ⚠️ **74% dos contratos têm `bullet_principal_mode = NULL`** — legado sem categorização. A nova regra precisa definir comportamento default explícito ou exigir backfill antes do deploy.

### 4.2 Parcelas bullet por status (total: **53 parcelas**)

| status | parcelas | contratos distintos | avg_total | avg_paid |
|--------|----------|---------------------|-----------|----------|
| `paid` | 21 | 15 | R$1.112,76 | R$380,38 |
| `pending` | 21 | 11 | R$705,95 | R$0 |
| `late` | 9 | 8 | R$2.832,22 | R$0 |
| `partial` | 2 | 2 | R$770,00 | R$160,00 |

> ⚠️ **`avg_paid = R$380 << avg_total = R$1.112` para parcelas `paid`** — confirma que `pay_bullet_interest_only` marca `paid` com pagamento parcial (apenas juros). Existem **11 parcelas `paid` com `amount_paid < amount_total`** (diferença de -R$500 a -R$3.000).

### 4.3 Contratos ativos sem parcela aberta: **8**

8 contratos com `status='active'` e sem nenhuma parcela `pending/late/partial`. Precisam de `generate_next_bullet_installment` ou, com a nova regra de `default_after_days`, podem entrar em default automaticamente sem histórico de ciclo aberto.

### 4.4 Parcelas pending com `amount_interest = 0`

2 parcelas `pending` com `amount_interest = 0` e sem `fine_amount`/`interest_delay_amount`. Trata-se de parcelas de **principal puro** (típico do modo `separate`, parcela final). Não são anomalias.

### 4.5 Anomalia: investment_id 520 — 11 parcelas `pending` simultâneas

- `bullet_principal_mode = 'separate'`, `capitalize_interest = true`
- **13 parcelas pré-geradas de uma só vez** no `created_at` idêntico (2026-03-22)
- Parcelas 1–12: `amount_interest=100, amount_principal=0`; parcela 13: `amount_principal=1000, amount_interest=0`
- Parcelas 1–2: `late`; parcelas 3–13: `pending`

> ⚠️ **Padrão legado de amortização pré-gerada**, diverge do modelo de geração dinâmica ciclo-a-ciclo. O guardrail atual de `generate_next_bullet_installment` (retorna se existe `pending`) **não bloqueia corretamente** quando há múltiplos `pending` — ele retorna o mais recente, mas os anteriores ficam abertos indefinidamente.

### 4.6 `remaining_balance`

- 25/27 contratos têm `remaining_balance` preenchido (R$100–R$20.000)
- 2 contratos com `remaining_balance = NULL` — legado anterior à feature; `process_bullet_payment` os trata via `COALESCE(remaining_balance, amount_invested)` — seguro porém não ideal

### 4.7 `parent_investment_id`

Nenhum contrato `interest_only` usa `parent_investment_id`. A cadeia de renovação ainda não existe nos dados.

### 4.8 Transações bullet por tipo

| tipo | qtd | soma |
|------|-----|------|
| `payment` | 22 | R$7.668 |
| `late_auto` | 12 | R$0 |
| `avulso` | 1 | R$500 |
| `missed` | 1 | R$1.100 |
| `deferred` | 1 | R$1.000 |

> `late_auto` com `amount=0` e todos os `portions=0` — são marcações de status, não movimentos financeiros.

### 4.9 `deferred_from_id`

1 parcela bullet com `deferred_from_id` preenchido; 1 com `notes`. Uso muito esporádico.

---

## 5. Riscos e Observações para Migration/RPCs Futuras

| # | Risco | Severidade | Ação |
|---|-------|-----------|------|
| R1 | **8 colunas ausentes em `investments`** (`default_after_days`, `break_fee_*`, `renewal_*`, `metadata`) | 🔴 Bloqueante | DDL obrigatório antes de qualquer RPC CB-002 |
| R2 | **9 colunas ausentes em `loan_installments`** (`cycle_number`, `capitalized_amount`, `rollover_from_id`, etc.) | 🔴 Bloqueante | DDL obrigatório |
| R3 | **20 contratos com `bullet_principal_mode=NULL`** — comportamento da nova regra indefinido para eles | 🔴 Alto | Definir tratamento default ou backfill `=together` antes do deploy |
| R4 | **`pay_bullet_interest_only` marca `paid` com `amount_paid < amount_total`** — semântica ambígua de "quitado" vs "ciclo rolado" | 🟠 Médio | Nova RPC de ciclo deve usar `cycle_number` ou flag para distinguir; ou revisar status para `rolled` |
| R5 | **`check_source_sum` constraint** em `investments`: qualquer capitalização que altere `amount_invested` vai estourar o CHECK | 🔴 Alto | Capitalização deve atualizar `remaining_balance` (já existente), nunca `amount_invested`; confirmar na nova RPC |
| R6 | **investment_id 520 — 11 parcelas pending**: guardrail de `generate_next_bullet_installment` apenas retorna a mais recente, não trata pré-geração em massa | 🟠 Médio | Guardrail deve verificar `pending` mais antigo ou adicionar lógica para contratos com parcelas pré-geradas |
| R7 | **8 contratos ativos sem parcela aberta** — `default_after_days` pode disparar inadimplência imediata sem histórico | 🟠 Médio | Backfill: gerar parcela pendente para esses contratos antes de ativar timer de inadimplência |
| R8 | **`create_legacy_investment` não aceita `capitalize_interest`** | 🟡 Baixo | Atualizar assinatura se houver importação de legado com esse campo |
| R9 | **`transaction_type` CHECK não inclui tipos novos** (ex: `bullet_rollover`, `bullet_cycle_close`) | 🟠 Médio | Alterar CHECK em `payment_transactions` na migration |
| R10 | **2 contratos com `remaining_balance=NULL`** | 🟡 Baixo | Backfill: `UPDATE investments SET remaining_balance = amount_invested WHERE calculation_mode='interest_only' AND remaining_balance IS NULL` |
| R11 | **`bullet_principal_mode=NULL` para `calculation_mode='interest_only'`** inserido por `create_investment_validated` (a RPC nulifica o campo) | 🔴 Alto | Corrigir a RPC para persistir `bullet_principal_mode` quando `interest_only` |

---

## 6. Queries Read-Only Executadas

1. `SELECT NOW(), current_database(), version()` — conexão e timestamp
2. `information_schema.columns WHERE table_name IN ('investments','loan_installments','payment_transactions')` — schema completo das 3 tabelas
3. `unnest(ARRAY[...])` verificando presença de colunas esperadas em `investments` e `loan_installments`
4. `information_schema.table_constraints + check_constraints` — CHECKs e FKs
5. `pg_type + pg_enum` — enums definidos
6. `pg_proc + pg_namespace` — assinaturas de RPCs (7 funções consultadas)
7. `pg_proc.prosrc` — corpo das 3 RPCs Bullet críticas + `create_investment_validated`
8. `investments WHERE calculation_mode='interest_only' GROUP BY bullet_principal_mode, capitalize_interest, status` — distribuição
9. `loan_installments JOIN investments WHERE calculation_mode='interest_only' GROUP BY status` — parcelas por status
10. Subquery: contratos ativos sem parcela aberta (pending/late/partial)
11. `loan_installments WHERE status='paid' AND amount_paid < amount_total` — rolagens
12. `loan_installments WHERE amount_interest=0 AND status IN ('pending','late','partial')` — parcelas sem juros abertas
13. `investments WHERE calculation_mode='interest_only'` — uso de `remaining_balance` e `parent_investment_id`
14. `loan_installments WHERE investment_id=520 ORDER BY number` — investigação de anomalia
15. `payment_transactions JOIN investments WHERE calculation_mode='interest_only' GROUP BY transaction_type`
16. Contagem de `deferred_from_id` e `notes` em parcelas bullet

---

**Resumo executivo:** Schema atual suporta parcialmente o modelo Bullet CB-002 — `remaining_balance`, `capitalize_interest`, `bullet_principal_mode`, `parent_investment_id` já existem e as RPCs de ciclo dinâmico (`generate_next_bullet_installment`, `process_bullet_payment`) já implementam capitalização e encerramento. Os bloqueadores reais são: (a) ausência total de `default_after_days`/`break_fee_*`/`renewal_*`/`metadata`, (b) 74% dos contratos legados sem `bullet_principal_mode` definido, (c) RPC `create_investment_validated` que anula `bullet_principal_mode` para bullets, e (d) anomalia de pré-geração em massa (investment 520) que o guardrail atual não cobre adequadamente.
