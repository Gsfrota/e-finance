# CALC-001 — Precisão financeira: daysLate timezone + float acumulado + limite de query

**Agentes:** @sm → @po → @dev → @qa → @devops
**Status:** Done
**Criada em:** 2026-06-24
**Prioridade:** P1 — exibe saldo errado para devedores e pode truncar dados de investidores
**Complexidade:** XS (2 arquivos, sem migration, sem nova lógica)
**Banco:** sem mudança de schema
**Valor:** Corrige três bugs de cálculo silencioso que impactam precisão financeira para devedores e investidores

---

## 1. Problemas

### CALC-1 — daysLate com timezone inconsistente (`useDebtorFinance.ts:104`)

```ts
// Bug: new Date('2026-06-24') → UTC midnight
//       new Date('2026-06-23T00:00:00') → LOCAL midnight (BRT = UTC-3)
const daysLate = isLate
  ? Math.floor((new Date(todayYMD).getTime() - new Date(inst.due_date + 'T00:00:00').getTime()) / (1000 * 3600 * 24))
  : 0;
```

**Cenário de falha:** parcela vencida há 1 dia (due_date = '2026-06-23', todayYMD = '2026-06-24'):
- today UTC = `2026-06-24T00:00:00Z`
- due_date local BRT = `2026-06-23T03:00:00Z`
- diferença = 21h → `Math.floor(0.875)` = **0 dias** (errado — deveria ser **1 dia**)

### CALC-2 — Float acumulado em contractPaid (`useDebtorFinance.ts:107,109`)

```ts
contractPaid += Number(inst.amount_total);    // paid
contractPaid += Number(inst.amount_paid || 0); // partial
```

Após 12 parcelas de R$100,00 = `contractPaid` pode ser `1199.9999999999998` em vez de `1200.00`.
`balance = Math.max(0, 1200 + 0 - 1199.9999999999998)` = `R$0,000000002` exibido ao devedor.

### CALC-3 — Sem limite na query de investimentos (`useInvestorMetrics.ts:514`)

```ts
.order('created_at', { ascending: false })
// sem .limit()
```

PostgREST retorna no máximo 1000 linhas por padrão, em silêncio, sem erro. Investidor com > 1000 contratos veria métricas incompletas sem nenhum aviso.

---

## 2. Acceptance Criteria

- **AC-1:** `useDebtorFinance.ts` — `daysLate` usa `Date.UTC()` para ambas as datas (todayYMD e due_date), eliminando o timezone mismatch.
- **AC-2:** `useDebtorFinance.ts` — `contractPaid` e `balance` arredondados a 2 casas com `Math.round(x * 100) / 100` antes de uso.
- **AC-3:** `useInvestorMetrics.ts` — query inclui `.limit(500)` e, quando `invData.length === 500`, loga `console.warn` indicando possível truncamento.
- **AC-4:** `npm run build` passa sem erros TypeScript.
- **AC-5:** Sem regressão nos cálculos existentes — contratos pagos continuam com `balance = 0`, parcelas em atraso continuam mostrando `daysLate >= 1`.

---

## 3. Implementação

### AC-1 + AC-2 — useDebtorFinance.ts

```ts
// ANTES (linha 104):
const daysLate = isLate
  ? Math.floor((new Date(todayYMD).getTime() - new Date(inst.due_date + 'T00:00:00').getTime()) / (1000 * 3600 * 24))
  : 0;

// DEPOIS:
const daysLate = isLate ? (() => {
  const [ty, tm, td] = todayYMD.split('-').map(Number);
  const [dy, dm, dd] = inst.due_date.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / (1000 * 3600 * 24));
})() : 0;
```

```ts
// ANTES (linha 138):
const balance = Math.max(0, contractTotal + totalFines - contractPaid);

// DEPOIS:
const contractPaidRounded = Math.round(contractPaid * 100) / 100;
const balance = Math.max(0, Math.round((contractTotal + totalFines - contractPaidRounded) * 100) / 100);
```

### AC-3 — useInvestorMetrics.ts

```ts
// ANTES (linha 514):
.order('created_at', { ascending: false })

// DEPOIS:
.order('created_at', { ascending: false })
.limit(500)
```

```ts
// APÓS o if (error) throw error; (linha 517):
if (invData && invData.length === 500) {
  console.warn('[useInvestorMetrics] Query truncada em 500 investimentos — dados podem estar incompletos.');
}
```

---

## 4. File List

- [x] `hooks/useDebtorFinance.ts` — AC-1 (daysLate UTC) + AC-2 (float arredondado)
- [x] `hooks/useInvestorMetrics.ts` — AC-3 (limit 500 + warn)

---

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 daysLate usa Date.UTC para ambas as datas | ✅ |
| AC-2 contractPaid e balance arredondados a 2 casas | ✅ |
| AC-3 limit(500) + console.warn quando truncado | ✅ |
| AC-4 `npm run build` | ✅ verde |
| AC-5 sem regressão | ✅ contratos pagos balance=0, daysLate>=1 confirmado |
