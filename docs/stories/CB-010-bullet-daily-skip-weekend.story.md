# CB-010 — [BUG] Pular Sábado/Domingo não funciona no bullet diário

**Agente:** @dev (impl) / @qa (gate) / @devops (push)
**Status:** InReview
**Criada em:** 2026-05-29
**Origem:** Teste manual do usuário — contrato bullet diário #3462 com "Pular Sábado/Domingo" ativos caiu em sábado 30/05/2026
**Epic:** EPIC-CB — Caderneta / Contratos Bullet
**Prioridade:** Alta — preferência do usuário (dias úteis) é silenciosamente ignorada; gera vencimentos em fim de semana

---

## 1. Causa-raiz (3 bugs em cascata, todos na camada de banco)

Frontend (`components/AdminContracts.tsx:531-532`) envia corretamente `p_skip_saturday`/`p_skip_sunday` para a RPC quando `frequency === 'daily'`. Os bugs estão nas funções PL/pgSQL.

### Bug 1 — `create_investment_validated`: 1ª parcela bullet ignora skip
No bloco bullet, a condição `IF p_start_date IS NOT NULL THEN v_due_date := p_start_date` é avaliada **antes** dos `ELSIF`, e o frontend SEMPRE envia `p_start_date` para daily (`AdminContracts.tsx:527`). A lógica de skip (no ramo `ELSE`) nunca é alcançada → a 1ª parcela cai no próprio `start_date` mesmo que seja sábado/domingo.

**Evidência:** contrato #3462 → 1ª parcela `due_date = 2026-05-30` (sábado, DOW=6) com skip ativo.

### Bug 2 — `create_investment_validated`: INSERT não persiste include_saturday/include_sunday
O `INSERT INTO investments` omite as colunas `include_saturday`/`include_sunday` (default `true` no schema). A preferência do usuário é perdida no banco.

**Evidência:** contrato #3462 → `include_saturday = true`, `include_sunday = true`.

### Bug 3 — `generate_next_bullet_installment`: rollover ignora fins de semana
No rollover de juros (daily), `v_next_due := v_last_inst.due_date + INTERVAL '1 day'` não verifica `include_saturday`/`include_sunday`. Mesmo corrigindo o Bug 2, parcelas futuras cairiam em sábado/domingo.

---

## 2. Acceptance Criteria

### AC-1: 1ª parcela bullet diário pula fins de semana
**Dado** um contrato bullet (`interest_only`) diário com "Pular Sábado" e/ou "Pular Domingo" ativos e `start_date` em fim de semana
**Quando** o contrato é criado
**Então** a 1ª parcela tem `due_date` no próximo dia útil permitido (não sábado se skip_saturday, não domingo se skip_sunday)

### AC-2: Preferência persistida no investments
**Dado** um contrato diário com skip ativo
**Então** `investments.include_saturday = NOT skip_saturday` e `include_sunday = NOT skip_sunday`

### AC-3: Rollover respeita dias úteis
**Dado** um contrato bullet diário com `include_saturday=false` e/ou `include_sunday=false`
**Quando** o usuário paga os juros (rollover gera próxima parcela)
**Então** a próxima `due_date` pula os fins de semana bloqueados

### AC-4: Sem regressão em mensal/semanal/parcelado
**Dado** contratos mensais, semanais (CB-009) ou parcelados
**Então** o cálculo de datas permanece idêntico ao atual

---

## 3. Implementação (migration PL/pgSQL — sem mudança de frontend)

### `create_investment_validated`
- **INSERT** de `investments`: adicionar `include_saturday = NOT COALESCE(p_skip_saturday,false)`, `include_sunday = NOT COALESCE(p_skip_sunday,false)`.
- **Bloco bullet**: reestruturar de `IF p_start_date IS NOT NULL` (topo) para `IF monthly / ELSIF weekly / ELSIF freelancer / ELSE daily`. No ramo daily: `v_candidate := COALESCE(p_start_date, CURRENT_DATE)` e avançar enquanto cair em fim de semana bloqueado. Mensal/semanal preservam `p_start_date` quando fornecido.

### `generate_next_bullet_installment`
- Após calcular `v_next_due`, se `frequency = 'daily'`, avançar `v_next_due` enquanto `(NOT include_sunday AND DOW=0) OR (NOT include_saturday AND DOW=6)`.

> Convenção DOW: `EXTRACT(DOW)` e JS `getDay()` = 0=Dom..6=Sáb (mesma de CB-009).

---

## 4. Definition of Done

- [x] AC-1 — 1ª parcela bullet diário pula fim de semana (start sáb 30/05 → seg 01/06)
- [x] AC-2 — include_saturday/include_sunday persistidos (`false`/`false` com skip)
- [x] AC-3 — rollover pula fim de semana (sex 05/06 → seg 08/06)
- [x] AC-4 — sem regressão mensal/semanal/parcelado (datas inalteradas, flags default `true`)
- [x] Migration aplicada e validada via BEGIN/ROLLBACK
- [x] Contrato de teste #3462 corrigido (parcela → seg 01/06, flags → false)

---

## 5. File List

- [x] Migration Supabase `cb010_bullet_daily_skip_weekend` + `cb010_harden_search_path_create_investment` (aplicadas via MCP)
- [x] `context/migration_cb010_bullet_daily_skip_weekend.sql` — DDL versionado para o repo (sem dados sensíveis)
- [x] Hardening de segurança: `SET search_path TO 'public','auth'` em `create_investment_validated` (fecha advisor lint 0011 `function_search_path_mutable`)

---

## 6. Evidência de validação (BEGIN/ROLLBACK em prod)

| Caso | include_sat | include_sun | 1ª parcela | Após rollover |
|------|:-----------:|:-----------:|------------|---------------|
| A — start sáb 30/05, skip ambos | false ✅ | false ✅ | Seg 01/06 ✅ | — |
| B — start sex 05/06, skip ambos | false ✅ | false ✅ | Sex 05/06 ✅ | Seg 08/06 ✅ |
| bullet mensal (não-regressão) | true ✅ | true ✅ | 10/06 ✅ | — |
| parcelado 3x mensal (não-regressão) | true ✅ | true ✅ | 10/06, 10/07, 10/08 ✅ | — |

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @dev (Dex) | Diagnóstico via contrato #3462 + inspeção das RPCs. 3 bugs identificados. |
| 2026-05-29 | @dev (Dex) | Migration `cb010_bullet_daily_skip_weekend` aplicada. 4 ACs validados via BEGIN/ROLLBACK. #3462 corrigido. InProgress → InReview. |
