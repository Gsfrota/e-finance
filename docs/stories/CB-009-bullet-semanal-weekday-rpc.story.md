# CB-009 — [FIX] Bullet semanal: RPC `create_investment_validated` ignora `p_weekday` na criação

**Agente:** @dev (migration RPC) / @qa (gate) / @devops (push)
**Status:** Done
**Criada em:** 2026-05-29
**Origem:** Bug confirmado em prod — @qa durante validação de cobertura pós-CB-008
**Epic:** Caderneta Bullet (CB)
**Prioridade:** Alta — todo contrato bullet semanal criado hoje vai para o dia errado

---

## 1. Contexto

### Descoberta

Durante smoke test de cobertura do fluxo bullet (pós-CB-008), o usuário criou dois contratos bullet semanais esperando vencimento na **segunda-feira 01/06**. Ambos foram gerados com vencimento na **sexta-feira 05/06**.

Contratos afetados em prod (criados em 2026-05-29):
- `investment_id = 3388` — due_date `2026-06-05` (deveria ser `2026-06-01`)
- `investment_id = 3389` — due_date `2026-06-05` (deveria ser `2026-06-01`)

### Root cause

Na RPC `create_investment_validated`, o bloco bullet semanal usa:

```sql
-- ERRADO — ignora p_weekday
ELSIF p_frequency = 'weekly' THEN
  v_due_date := (CURRENT_DATE + INTERVAL '7 days')::DATE;
```

Isso soma 7 dias fixos a partir de hoje, sempre caindo no mesmo dia da semana de **hoje**, independente do `p_weekday` escolhido pelo admin.

**Hoje = sexta (DOW=5) → + 7 dias = sexta 05/jun.**
**Admin queria segunda (DOW=1) → esperado: 01/jun.**

O parâmetro `p_weekday` é corretamente enviado pelo frontend (`AdminContracts.tsx:512`) mas **nunca é lido** pelo bloco bullet.

### Dados do bug

| Hoje (DOW) | `p_weekday` enviado | Due date gerada | Due date esperada |
|---|---|---|---|
| Sexta (5) | 1 (segunda) | 2026-06-05 (sexta) | 2026-06-01 (segunda) |

### Contexto adicional — contrato #3118

O contrato `investment_id = 3118` (criado em 2026-05-25) tem `due_date = 2026-06-01` (segunda) e foi criado corretamente. Provável que naquele dia o dia da semana corrente fosse segunda, fazendo `+7 = segunda` por acidente.

---

## 2. Arquivos-chave

| Recurso | Relevância |
|---|---|
| Supabase prod: `create_investment_validated` | RPC a corrigir — bloco bullet weekly |
| `components/AdminContracts.tsx:512` | Frontend envia `p_weekday` corretamente |
| `utils/financials.ts:41-48` | `calculateInstallmentDates` (preview) — já calcula corretamente via JS |

---

## 3. Bug a corrigir

### BUG-1 — Bullet semanal ignora `p_weekday` na geração da primeira parcela `[HIGH]`

**RPC:** `create_investment_validated` — bloco `IF v_is_bullet THEN ... ELSIF p_frequency = 'weekly'`

**Código atual (errado):**
```sql
ELSIF p_frequency = 'weekly' THEN
  v_due_date := (CURRENT_DATE + INTERVAL '7 days')::DATE;
```

**Fix — calcular próxima ocorrência do weekday desejado:**
```sql
ELSIF p_frequency = 'weekly' THEN
  DECLARE
    v_today_dow  INTEGER := EXTRACT(DOW FROM CURRENT_DATE)::INTEGER;
    v_target_dow INTEGER := COALESCE(p_weekday, 1);
    v_days_ahead INTEGER := ((v_target_dow - v_today_dow + 7) % 7);
  BEGIN
    IF v_days_ahead = 0 THEN v_days_ahead := 7; END IF;
    v_due_date := (CURRENT_DATE + (v_days_ahead || ' days')::INTERVAL)::DATE;
  END;
```

**Lógica:**
- Hoje = sexta (DOW=5), `p_weekday=1` (segunda): `(1 - 5 + 7) % 7 = 3` → 29/mai + 3 = **01/jun** ✅
- Hoje = sexta (DOW=5), `p_weekday=5` (sexta): `(5 - 5 + 7) % 7 = 0` → `v_days_ahead = 7` → 05/jun ✅ (próxima sexta, não hoje)
- Hoje = segunda (DOW=1), `p_weekday=1` (segunda): `(1 - 1 + 7) % 7 = 0` → `v_days_ahead = 7` → próxima segunda ✅

**Convenção DOW:** JS `getDay()` e PostgreSQL `EXTRACT(DOW ...)` usam a mesma convenção: 0=Dom, 1=Seg, …, 6=Sáb.

---

## 4. Fora do escopo

### OUT (não incluir nesta story)

- Branch não-bullet (`FOR i IN 1..p_total_installments LOOP`) — o mesmo cálculo semanal errado existe lá, mas:
  - Contratos parcelados semanais têm preview correto no frontend (`calculateInstallmentDates`)
  - O admin pode editar as datas após criação
  - Correção em story separada para não acumular risco
- Correção retroativa dos contratos #3388 e #3389 já criados errados — tratar manualmente ou em story de migração de dados
- `generate_next_bullet_installment` — usa `due_date + 7 days` a partir da última parcela, o que é correto (mantém a cadência semanal independente do dia de referência)

---

## 5. Critérios de aceite

### AC-1: Primeiro vencimento respeita o weekday
**Dado** admin cria bullet semanal com `p_weekday = 1` (segunda-feira) em qualquer dia da semana
**Quando** o contrato é criado
**Então** a primeira parcela tem `due_date` na próxima segunda-feira

### AC-2: Nunca cai no próprio dia de criação
**Dado** admin cria bullet semanal numa segunda-feira com `p_weekday = 1`
**Então** `due_date` é a **próxima** segunda (+ 7 dias), não hoje

### AC-3: Funciona para qualquer dia da semana
**Dado** `p_weekday` ∈ {0,1,2,3,4,5,6}
**Então** `due_date` é a próxima ocorrência desse dia após hoje

### AC-4: Não-regressão — outros modos inalterados
- Bullet mensal: inalterado
- Bullet daily/freelancer: inalterado
- Contratos parcelados (não-bullet): inalterado

---

## 6. Dependências

- **Requer:** CB-001 a CB-008 (todos em prod) ✅
- **Bloqueia:** nenhuma story

---

## 7. Complexidade e riscos

**Estimativa:** 2 pontos (1 migration cirúrgica, 0 código frontend)

**Riscos:**
- R1: Convenção DOW — confirmar que `p_weekday=1` = segunda tanto no frontend (JS `getDay()`) quanto no PostgreSQL (`EXTRACT(DOW)`) antes de aplicar. **Confirmado:** ambos usam 0=Dom, 1=Seg, …, 6=Sáb.
- R2: Contrato criado no mesmo dia do weekday alvo → sem o guard `IF v_days_ahead = 0 THEN v_days_ahead := 7`, o vencimento seria hoje. Guard incluído no fix.
- R3: Contratos já criados errados (#3388, #3389) — a migration não os corrige retroativamente. Correção manual ou data migration separada.

---

## 8. Definition of Done

- [x] Migration aplicada em prod via `mcp__supabase__apply_migration` (`cb009_fix_bullet_weekly_weekday_calculation`)
- [x] Validação SQL: 7/7 cenários DOW corretos (hoje=sexta, DOW=1→01/jun segunda ✅)
- [x] Contrato bullet semanal criado após a migration tem `due_date` no weekday correto (SQL direto: AC-1 PASS)
- [x] @qa gate PASS
- [x] Build TypeScript sem erros (sem mudança de frontend)

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @qa (Quinn) | Bug identificado durante validação de cobertura pós-CB-008. Root cause: RPC ignora `p_weekday` e soma +7 fixo. |
| 2026-05-29 | @sm (River) | Story CB-009 criada a partir do bug report do @qa. Draft. |
| 2026-05-29 | @po (Pax) | *validate-story-draft — GO 10/10. Draft → Ready. R3 (dados retroativos) explicitamente fora do escopo — correto. |
| 2026-05-29 | @dev (Dex) | Migration `cb009_fix_bullet_weekly_weekday_calculation` aplicada em prod. Mudanças: +`v_days_ahead INTEGER` no DECLARE; bloco bullet weekly usa `((COALESCE(p_weekday,1) - EXTRACT(DOW FROM CURRENT_DATE)::INT + 7) % 7)` com guard para dia=0→7. Validação SQL: 7/7 DOW corretos. Ready → InReview. |
| 2026-05-29 | @qa (Quinn) | **PASS** — AC-1: p_weekday=1→01/06 segunda ✅; AC-2: guard ativo (sexta→próxima sexta, não hoje) ✅; AC-3: 7/7 DOWs corretos ✅; AC-4: mensal/daily/freelancer inalterados ✅. Migration sem alteração de frontend. InReview → Done. |
| 2026-05-29 | @qa (Quinn) | **Validação real em prod:** usuário criou investment #3390 (semanal, p_weekday=1). due_date=`2026-06-01 (Monday)` ✅. Cadência: 01/06→08/06→15/06 (todas segundas, DOW=1). audit_events: `bullet_contract_created` + `bullet_cycle_created` gravados. CB-009 100% validado em prod. |
