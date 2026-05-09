# DailyCollectionView — Tela de Cobrança Diária

## Localização

- **Componente:** `components/DailyCollectionView.tsx`
- **Hook de dados:** `hooks/useDashboardData.ts`
- **Acessível via:** `AppView.COLLECTION` (botão "Cobranças" no sidebar/home)
- **Roles autorizadas:** somente `admin` (gate em `App.tsx:1083` — `currentView === AppView.COLLECTION && profile?.role === 'admin' && !isFreeLocked`)
- **Plano:** bloqueada para tenants em plano `free` sem trial ativo (`isFreePlanLocked` em `services/companyScope.ts`)

## Propósito

Tela operacional principal do admin para acompanhar parcelas a receber no dia. É a **fonte de receita imediata** do tenant: cada parcela visível aqui é dinheiro que precisa entrar hoje.

Reclamações recorrentes nessa tela são **P0 imediato** — silêncio na cobrança = receita perdida.

---

## Layout (visão de cima para baixo)

```
┌────────────────────────────────────────────────┐
│ ← Cobrança Diária         [Atualizando…] [🔄]  │  ← Header sticky
├────────────────────────────────────────────────┤
│ ⚠️ N parcelas em atraso — R$ X,XX           › │  ← Banner persistente (condicional)
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐  │
│  │ RECEBER HOJE          CARTEIRA           │  │
│  │ DD/MM/YYYY            tenant.name        │  │
│  │ R$ X.XXX,XX (verde)                      │  │  ← Summary card
│  │ [📅 Outros vencimentos ▼]                │  │
│  │  ┌────────┬────────┬────────┐           │  │
│  │  │ATRAS.  │ HOJE   │RECEBIDO│           │  │  ← 3 stat-cards clicáveis
│  │  │  N     │  N     │  N     │           │  │
│  │  │ R$ X   │ R$ X   │ R$ X   │           │  │
│  │  └────────┴────────┴────────┘           │  │
│  └──────────────────────────────────────────┘  │
├────────────────────────────────────────────────┤
│ [Outros vencimentos] (expandido condicional)   │  ← Buckets 3d/7d/15d/30d
├────────────────────────────────────────────────┤
│ [🔍 Buscar cliente…]              [📅]         │  ← Search + date picker
├────────────────────────────────────────────────┤
│ Lista de parcelas (ClientCard, paginada por    │
│ bucket selecionado: hoje / atrasados / pagas   │
│ hoje / futuras por bucket)                     │
└────────────────────────────────────────────────┘
```

---

## Sub-views (mesma rota, comportamento condicional)

| Estado                          | Ativador                             | Componente             |
|---------------------------------|--------------------------------------|------------------------|
| Lista (default)                 | nenhum                               | render principal       |
| Detalhe da parcela              | `selectedInstallment != null`        | `InstallmentDetailScreen` (importado de `InstallmentDetailFlow.tsx`) |
| Form de ação (pay/refinance/...)| `installmentAction != null`          | `InstallmentFormScreen` |

Tap num `ClientCard` → abre `InstallmentDetailScreen`. Lá o admin escolhe a ação (pagar/parcial/refinanciar/editar/cobrar juros/estornar) e cai no `InstallmentFormScreen`.

---

## Buckets de parcelas

Calculados via `useMemo` a partir do array `installments` do hook:

| Bucket            | Filtro                                                       | Variável estado          |
|-------------------|--------------------------------------------------------------|--------------------------|
| `overdueItems`    | `due_date < today && status !== 'paid'`                      | sempre derivado          |
| `todayItems`      | `due_date === today && status !== 'paid'`                    | sempre derivado          |
| `paidToday`       | `(status='paid'∥'partial') && amount_paid>0 && paid_at = today (BR)` | sempre derivado    |
| `futureBuckets.3d`  | `due_date > today && due_date <= today+3`                  | derivado                 |
| `futureBuckets.7d`  | `due_date > today+3 && due_date <= today+7`                | derivado                 |
| `futureBuckets.15d` | `due_date > today+7 && due_date <= today+15`               | derivado                 |
| `futureBuckets.30d` | `due_date > today+15 && due_date <= today+30`              | derivado                 |

`today` = `getBrazilToday()` — **sempre** via `services/dateUtils.ts`, nunca `new Date().toISOString()`.

**BR-TZ-001 (regressão histórica):** datas em America/São_Paulo. Toda aritmética de datas deve usar `addDaysBR()` / `getBrazilToday()` / `isoToBrazilYMD()`. Não criar `addDays` local com `toISOString()` — já regrediu 4 vezes.

---

## Estado local (useState)

| Estado                  | Tipo                            | Significado                                    |
|-------------------------|---------------------------------|------------------------------------------------|
| `selectedInstallment`   | `LoanInstallment \| null`       | Parcela aberta no detail screen                |
| `installmentAction`     | `InstallmentAction`             | Ação do form screen (pay/refinance/edit/...)   |
| `search`                | `string`                        | Filtro de busca por nome do payer              |
| `showOtherDues`         | `boolean`                       | Toggle do accordion "Outros vencimentos"       |
| `showPaidToday`         | `boolean`                       | Toggle do accordion "Pagas hoje"               |
| `showOverdue`           | `boolean`                       | Modo "ver atrasados" (substitui lista de hoje) |

---

## Componentes internos

### Header (linhas 173-203)

- Botão back opcional (`onBack` prop)
- Título "Cobrança Diária" centrado
- Pill `Atualizando…` ao lado do refresh quando `isStale && !loading` (cache stale do `services/cache.ts`)
- Botão `RefreshCw` chama `refetch()` (com spinner quando loading)

### Banner persistente de atrasados (linhas 206-220)

```tsx
{!loading && !showOverdue && overdueItems.length > 0 && (
  <button onClick={() => setShowOverdue(true)}>
    ⚠️ N parcelas em atraso — R$ X,XX  ›
  </button>
)}
```

Aparece **só** quando há atrasos e o admin **não** está vendo a lista de atrasados. Tap → abre lista de atrasados.

### Summary Card (linhas 226-296)

- Top: data formatada BR, nome da carteira (tenant)
- "R$ X" (verde) — total a receber hoje (`grandTotal = totalToday`)
- Botão "Outros vencimentos" — toggle do accordion futuros
- 3 stat-cards (grid-cols-3):
  - **Atrasado** (vermelho, clicável → mostra lista de atrasados)
  - **Hoje** (amarelo, clicável → volta para hoje)
  - **Recebido** (verde, **NÃO** clicável — só exibe totalPaidToday)

### ClientCard (linhas 454+)

Renderiza uma parcela individual. Layout:

```
┌─────────────────────────────────────────────┐
│ [👤 40px]  [PARCIAL]            [R$ 200,00] │  ← status badge + nome + valor (mesma linha)
│            Marcos Oliveira                  │
│            BULLET Saldo: R$ 4.800,00        │  ← bullet/saldo (condicional)
│            Parcela 5 · Venc. 08/05/2026     │  ← meta full-width
│            Recebido: R$ 200,00              │  ← se isPartial
│                                          [›]│
└─────────────────────────────────────────────┘
```

Cores derivadas em runtime via `borderColor`/`accentColor`/`iconColor`/`badgeBg`:

| Estado                    | Cor                  | CSS variable           |
|---------------------------|----------------------|------------------------|
| Pago                      | 🟢 verde             | `--accent-positive`    |
| Hoje pendente             | 🟡 amarelo           | `--accent-warning`     |
| Atrasado                  | 🔴 vermelho          | `--accent-danger`      |
| Parcial                   | 🔵 azul              | `--accent-steel`       |
| Anomalia (surplus_zeroed) | 🔴 vermelho          | `--accent-danger`      |
| Futuro pendente           | 🟢 verde             | `--accent-positive`    |

**Cuidado:** `isToday` é computado dentro do `ClientCard` chamando `getBrazilToday()` — ok porque é determinístico e cheap.

---

## Hook `useDashboardData(tenantId, companyId)`

Fonte única de dados para esta tela (e também `Dashboard`, `AdminHome`, `CollectionDashboard`).

### Retorno

```typescript
{
  installments: LoanInstallment[];   // todas relevantes (pending/late/partial + paidThisMonth)
  investments: Investment[];         // todos os contratos do tenant/company
  allPaidInstallments: LoanInstallment[]; // histórico completo de pagas/parciais
  stats: AdminDashboardStats;
  detailedKPIs: DashboardKPIs;
  monthRange: { start, end };
  loading: boolean;
  isStale: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}
```

### Paginação (CRÍTICO — BUG HISTÓRICO)

PostgREST limita silenciosamente em **1.000 linhas por padrão**. Sem `.range()`, queries que retornariam mais são truncadas sem erro.

`fetchAllPages(buildQuery)` (em `useDashboardData.ts:272`) faz loop com `.range(from, from + 999)` até bloco voltar < PAGE_SIZE. Aplica em **investments** e **loan_installments**.

**Por que factory function (`buildQuery`)?** Cada chamada `.range()` precisa ser num builder novo, senão o estado mutável da query (`tenant_id`, `company_id` filters) se acumula entre páginas.

### Filtros aplicados na query

| Filtro                           | Quando                    | Por quê                                           |
|----------------------------------|---------------------------|---------------------------------------------------|
| `.eq('tenant_id', tenantId)`     | sempre que tenantId existe| Defesa em profundidade (RLS já filtra)            |
| `.eq('company_id', companyId)`   | quando companyId é string | Multi-empresa (escopo `'all'` não filtra)         |
| `.order('due_date', asc)` / `.order('created_at', desc)` | sempre  | Ordem estável                                     |

### Filtros aplicados em memória

- **BR-CNT-011:** `inst.investment.status !== 'completed'` — exclui parcelas de contratos concluídos
- **BR-REL-002 + BR-REL-018:** `!isSalaryPhantom(inst)` — exclui parcelas fantasma do SalaryDashboard
- **isOverdue computado:** `inst.due_date < todayYMD && !isPaid && outstanding > 0.01` — quando true, status local vira `'late'` mesmo se DB ainda diz `'pending'`

### Cache (services/cache.ts)

- TTL: 5 minutos
- `isStale`: indica que está servindo cache enquanto refetch acontece em background
- Refresh manual via `refetch()` (botão 🔄 do header)

---

## Regras de negócio (BR-*)

| ID          | Regra                                                                   | Onde aplica                       |
|-------------|-------------------------------------------------------------------------|-----------------------------------|
| BR-TZ-001   | Datas em `America/São_Paulo`; usar `dateUtils` sempre                   | `today`, `addDaysBR`, `isoToBrazilYMD` |
| BR-CNT-011  | Parcelas de investimentos `status='completed'` NÃO entram na cobrança   | `useDashboardData` filter         |
| BR-REL-002  | `isSalaryPhantom` — parcelas fantasma fora do salário                   | `allPaidInstallments`             |
| BR-REL-017  | Parcelas de contratos `completed` ainda contam no histórico de rendimento | `allPaidInstallments` inclui     |
| BR-REL-018  | Predicado único `isSalaryPhantom` para fantasmas                        | `useDashboardData`                |

---

## Cálculo de outstanding

`calcOutstanding(inst)` está exportado de `components/InstallmentDetailFlow.tsx`:

```
outstanding = amount_total + fine_amount + interest_delay_amount - amount_paid
```

Para parcelas atrasadas, `fine_amount` e `interest_delay_amount` somam ao valor base. O badge da `ClientCard` exibe esse valor (não `amount_total`).

---

## Reuso obrigatório (NÃO reimplementar)

| Função / componente               | Origem                                            |
|-----------------------------------|---------------------------------------------------|
| `getBrazilToday()`, `addDaysBR()`, `isoToBrazilYMD()` | `services/dateUtils.ts`        |
| `useCompanyContext()`             | `services/companyScope.ts`                        |
| `calcOutstanding`, `fmtDate`, `fmtMoney`, `getInstallmentModInfo`, `ModBadge` | `components/InstallmentDetailFlow.tsx` |
| `InstallmentDetailScreen`, `InstallmentFormScreen` | `components/InstallmentDetailFlow.tsx` |
| `chip-paid`, `chip-pending`, `chip-late`, `chip-partial` | `index.css:467-471`           |

---

## Bugs históricos resolvidos (commit `0dd4ee0`, 2026-05-08)

### 🔴 Truncamento PostgREST (raiz da reclamação MD Aquino)

**Sintoma:** "parcelas que era pra cobrar hoje não aparecem". Tenants com >1.000 parcelas tinham as mais futuras silenciosamente cortadas.

**Causa:** queries em `useDashboardData` sem `.range()`/`.limit()` → PostgREST aplica limite default de 1.000.

**Fix:** `fetchAllPages` com factory pattern.

### 🔴 Paleta semântica invertida

**Sintoma:** "hoje tá verde quem ta faltando pagar".

**Causa:**
- `chip-paid` usava `--accent-steel` (azul-cinza) → parecia parcial, não pago
- `ClientCard` border default era verde, então **pendente de hoje ficava com borda verde** (visualmente "ok / quitado")

**Fix:**
- `index.css:470` — `chip-paid` agora `--accent-positive` (verde)
- `ClientCard` agora computa `isToday` e aplica amarelo (`--accent-warning`) para hoje pendente

### 🟡 BR-TZ-001 regredido (4ª vez)

**Sintoma:** Após 21h BRT, buckets futuros (3d/7d/15d/30d) mostravam datas erradas.

**Causa:** função local `addDays` usava `toISOString().split('T')[0]` — retorna data UTC, não BRT.

**Fix:** importar e usar `addDaysBR` de `services/dateUtils.ts`.

### 🟡 Cache stale invisível

**Sintoma:** Após criar/editar parcela e voltar pra Cobrança, via estado antigo por alguns segundos sem feedback.

**Fix:** pill "Atualizando…" no header quando `isStale && !loading`.

### 🟡 Sobreposição visual badge × data (Iteração 2)

**Sintoma:** badge de valor ficava colado/sobre a linha "Parcela X · Venc. DD/MM/YYYY".

**Causa:** layout de 2 colunas (info `flex-1` + badge `shrink-0`) com `justify-between` na meta-row empurrava data para o canto direito da info column, encostando no badge.

**Fix:** badge movido para a mesma linha do nome (top-right da info column). Meta-row agora full-width sem competir.

---

## Performance

- **Sem virtualização** — decisão consciente. Listas até ~300 itens renderizam suavemente em mobile/desktop modernos.
- **Paginação automática no fetch** — não trava UI; loop em background com `withRetry`.
- **`useMemo` em todos os derivados** — buckets, totais, listas filtradas.
- **Sem polling** — refresh manual via botão ou `onSuccess` de form.

---

## Testes

### E2E

Não há suite dedicada para `DailyCollectionView`. Testes correlatos:
- `e2e/payment/surplus-partial-overdue.spec.ts` — fluxo de baixa com sobrapagamento
- `e2e/reports/dashboard-monthly.spec.ts` — KPIs derivados de `useDashboardData`

### Mock visual

Script: `/tmp/screenshot-mock.js` (gerado durante a investigação MD Aquino).

Funciona assim:
1. Sobe o dev server (`npm run dev -- --port 3000`)
2. `page.route()` intercepta `**/rest/v1/investments*` e `**/rest/v1/loan_installments*`
3. Retorna mock JSON com mistura de status (late, today pending, partial, paid, future)
4. Captura prints em `/home/dev/workspace/e-finance/prints/`

Estados mockados que cobrem 100% dos visuais:
- 3 atrasados (borda vermelha)
- 3 hoje pendentes (borda amarela)
- 1 hoje parcial (borda azul)
- 1 pago hoje (verde)
- 8 futuros distribuídos pelos buckets 3d/7d/15d/30d

---

## Quando alterar essa tela

**Sempre executar:**
1. Conferir que a query continua paginando (não quebrar `fetchAllPages`)
2. Conferir que `today` vem de `getBrazilToday()`, NUNCA de `new Date()`
3. Conferir que filtro `BR-CNT-011` (excluir `completed`) está aplicado
4. Validar paleta semântica (verde=pago / amarelo=hoje / vermelho=atrasado / azul=parcial)
5. Rodar mock visual e capturar antes/depois

**Antes de mudar layout do `ClientCard`:**
- Verificar se badge de valor não está competindo com meta-row pelo canto direito
- Conferir que truncate funciona em nomes longos
- Testar com bullet+saldo (Fernanda Costa no mock) — caso mais carregado

---

## Stakeholder primário

**Michael David Fernandes de Aquino (MD Aquino)** — admin do tenant Md Veiculos. Volume real: 1.294 parcelas (data de referência 2026-05-08). Reclamações dele sobre essa tela são P0 imediato.
