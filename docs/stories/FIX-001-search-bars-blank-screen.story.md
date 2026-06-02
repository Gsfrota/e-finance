# FIX-001 — Busca derruba a tela ("fica azul e some tudo")

**Agentes:** @qa (triagem + spec) → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-06-02
**Prioridade:** P0 — crash de produção reportado por cliente (recorrente)
**Banco:** sem mudança de schema/RPC

---

## 1. Problema

Cliente reportou que, ao **pesquisar nos "clientes do dia"** (tela Cobrança diária),
a tela "fica azul e some tudo". Já aconteceu outras vezes em outras buscas.

Causa raiz dupla:

1. **Sistêmica:** o app **não tinha nenhum ErrorBoundary** (`index.tsx` montava
   `StrictMode > ToastProvider > App`). Qualquer exceção durante o render desmontava
   a árvore React inteira, sobrando só o gradiente azulado do `body` → "tela azul + some tudo".
2. **Local (gatilho):** filtros de busca chamavam `.toLowerCase()` sobre `full_name`
   **sem guarda** — e `profiles.full_name` é nullable. Um devedor com nome nulo (ou valor
   não-string) fazia o filtro lançar `TypeError` durante o render.

## 2. Acceptance Criteria

- **AC-1:** Digitar em **qualquer** barra de busca nunca derruba a UI, mesmo com
  registros de `full_name` nulo/não-string.
- **AC-2:** A busca da Cobrança diária casa por `full_name` **e** `payer_name`
  (paridade com os cards).
- **AC-3:** Qualquer exceção de render passa a exibir tela amigável ("Algo deu errado" +
  "Tentar Novamente") em vez de tela em branco/azul, e o erro é logado via `logError`.
- **AC-4:** Todas as barras de busca alcançáveis foram auditadas e endurecidas
  (`.toLowerCase()` só sobre valor coalescido).

## 3. Implementação

- **Novo** `components/ErrorBoundary.tsx` — class component com
  `getDerivedStateFromError` + `componentDidCatch` (→ `logError('React render', err)`),
  fallback reusando o visual de erro de `App.tsx`. Montado em `index.tsx` envolvendo `<App/>`.
- **Filtros endurecidos** (`(campo || '').toLowerCase()` / `String(... ?? '')`):
  - `components/DailyCollectionView.tsx` — `visibleItems` (+ fallback `payer_name`, AC-2)
  - `components/LegacyContractPage.tsx:321` — busca de devedor
  - `components/QuickContractInput.tsx` — `findDebtorByName` e dropdown de devedor
- Já seguras (sem alteração): `AdminUsers`, `AdminContracts`, `PlatformOwnerPanel`
  (já usavam `|| ''` / `?? ''`). `DashboardWidgets.FiltersBar` é código morto (não acoplado).

## 4. File List

- `components/ErrorBoundary.tsx` (novo)
- `index.tsx`
- `components/DailyCollectionView.tsx`
- `components/LegacyContractPage.tsx`
- `components/QuickContractInput.tsx`

## 5. QA Results

Verificado na UI real (preview 4173) contra o Supabase de produção, em tenant-sandbox
isolado com dado venenoso (devedor `full_name = NULL`) — ver [[reference_qa_test_user]].

- ✅ AC-1/AC-4: smoke em todas as barras alcançáveis (Cobranças, Usuários, Contratos,
  Contrato Antigo) digitando termos venenosos → **nenhum crash**, zero `pageerror`.
- ✅ AC-2: busca "maria"/"joão"/"12345" filtra corretamente (screenshots).
- ✅ AC-3: throw deliberado no render → tela "Algo deu errado" + "Tentar Novamente"
  (não mais tela azul/branca).
- ✅ `npm run build` verde.

**Gate:** PASS.
