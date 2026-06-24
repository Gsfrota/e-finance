# CRIT-8-9 — filtro tenant_id ausente + chave de cache sem user.id

**Agentes:** @sm → @po → @dev → @qa → @devops
**Status:** Done
**Criada em:** 2026-06-24
**Prioridade:** P1 — vazamento de dados entre tenants e cache com chave errada
**Complexidade:** XS (2 arquivos, sem migration, sem nova lógica)
**Banco:** sem mudança de schema
**Valor:** Garante isolamento multi-tenant nas queries e corrige otimização de cache quebrada

---

## 1. Problema

### CRIT-8 — InvestorDashboard.tsx:49
`handleInstallmentClick` busca uma parcela por `id` sem filtrar por `tenant_id`:
```ts
supabase.from('loan_installments').select('...').eq('id', installmentId).single();
```
Em caso de misconfiguration de RLS, um `installmentId` forjado poderia retornar dados de outro tenant. Adicionar `.eq('tenant_id', profile.tenant_id)` eliminando o risco ao nível de aplicação.

### CRIT-9 — useDebtorFinance.ts:43-49
Os inicializadores de `useState` leem o cache com chave genérica `'debtor_finance'`:
```ts
const cached = getCached<DebtorMetrics>('debtor_finance'); // chave errada
```
Mas o `useEffect` grava com `debtor_finance_${user.id}`. As duas chaves nunca coincidem — a inicialização nunca aquece o estado a partir do cache. Pior: se algum código futuro gravar na chave genérica, qualquer usuário poderia ver dados de outro usuário na renderização inicial.

## 2. Acceptance Criteria

- **AC-1:** `InvestorDashboard.tsx` — `handleInstallmentClick` inclui `.eq('tenant_id', ...)` usando `profile.tenant_id` do `CompanyContext`.
- **AC-2:** `useDebtorFinance.ts` — `useState<DebtorMetrics>` usa valor padrão direto (sem `getCached`); `useState<boolean>` para `isStale` usa `false` direto.
- **AC-3:** O `useEffect` em `useDebtorFinance.ts` continua usando a chave `debtor_finance_${user.id}` para leitura e escrita (sem alteração).
- **AC-4:** `npm run build` passa sem erros TypeScript.
- **AC-5:** Nenhuma regressão nas queries existentes — `handleInstallmentClick` continua retornando a parcela correta para o usuário autenticado.

## 3. Implementação

### AC-1 — InvestorDashboard.tsx

```tsx
// ADICIONAR import
import { useCompanyContext } from '../services/companyScope';

// DENTRO do componente InvestorDashboard, após linha dos hooks existentes:
const { profile } = useCompanyContext();

// MODIFICAR handleInstallmentClick (linha ~49):
const { data } = await supabase
  .from('loan_installments')
  .select('*, investment:investments(*, payer:profiles!investments_payer_id_fkey(id, full_name), loan_installments(*))')
  .eq('id', installmentId)
  .eq('tenant_id', profile?.tenant_id ?? '')
  .single();
```

### AC-2 — useDebtorFinance.ts

```ts
// ANTES (linhas 42-50):
const [metrics, setMetrics] = useState<DebtorMetrics>(() => {
  const cached = getCached<DebtorMetrics>('debtor_finance');
  return cached?.data ?? { currentBalance: 0, hasLatePayment: false, nextPayment: null, userName: '', contracts: [] };
});
const [isStale, setIsStale] = useState(() => {
  const cached = getCached<DebtorMetrics>('debtor_finance');
  return cached?.stale ?? false;
});

// DEPOIS:
const [metrics, setMetrics] = useState<DebtorMetrics>({
  currentBalance: 0, hasLatePayment: false, nextPayment: null, userName: '', contracts: [],
});
const [isStale, setIsStale] = useState(false);
```

Remover também o import `getCached` se não for mais usado nas linhas 43-49 (verificar se ainda é usado no useEffect — se sim, manter o import).

### Fora de escopo

- Refactor completo de `useInvestorMetrics` para multi-tenant
- Adicionar `tenant_id` em `fetchProfileByAuthUserId` (função projetada para lookup cross-tenant no login)

## 4. File List

- [x] `components/InvestorDashboard.tsx` — add useCompanyContext + tenant_id filter
- [x] `hooks/useDebtorFinance.ts` — corrigir useState initializers (remover getCached errado)

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 `InvestorDashboard` filtro `tenant_id` | ✅ `.eq('tenant_id', profile?.tenant_id ?? '')` adicionado linha 53 |
| AC-2 `useDebtorFinance` useState sem getCached | ✅ inicializadores trocados por defaults diretos |
| AC-3 useEffect continua usando chave user-específica | ✅ `debtor_finance_${user.id}` nas linhas 62-63 e 200 inalterados |
| AC-4 `npm run build` | ✅ verde (exit 0, 49s) |
| AC-5 sem regressão em handleInstallmentClick | ✅ filtro adicional não quebra query — ID ainda é único, tenant_id isola pelo tenant |
