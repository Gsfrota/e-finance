# FIX-001 — Busca derruba a tela ("fica azul e some tudo")

**Agentes:** @qa (triagem + spec) → @dev → @qa → @devops
**Status:** In Progress — gate blindado e deploy em 2026-08-03
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

### Recorrência de 2026-08-03

O sintoma voltou a ser reportado em produção mesmo após o fix original. A auditoria
encontrou dois caminhos adicionais que produzem o mesmo resultado visual:

1. `CadernetaBullet` ainda substitui toda a tela por um loader sempre que
   `useDashboardData.refetch()` começa (inclusive depois de uma baixa). A correção
   stale-while-revalidate do commit `8df9413` ficou restrita à Cobrança diária e usa
   `array.length` como proxy de carga concluída, o que também falha para carteiras vazias.
2. O fallback React só existe depois que o bundle é carregado e avaliado. Se o HTML
   chega ao cliente mas o bundle falha ou fica incompatível com um service worker/cache
   antigo, o `#root` permanece vazio e apenas o fundo azul do documento fica visível.

## 2. Acceptance Criteria

- **AC-1:** Digitar em **qualquer** barra de busca nunca derruba a UI, mesmo com
  registros de `full_name` nulo/não-string.
- **AC-2:** A busca da Cobrança diária casa por `full_name` **e** `payer_name`
  (paridade com os cards).
- **AC-3:** Qualquer exceção de render passa a exibir tela amigável ("Algo deu errado" +
  "Tentar Novamente") em vez de tela em branco/azul, e o erro é logado via `logError`.
- **AC-4:** Todas as barras de busca alcançáveis foram auditadas e endurecidas
  (`.toLowerCase()` só sobre valor coalescido).
- **AC-5:** Refetches preservam o último conteúdo renderizado da Caderneta, Dashboard e
  Cobrança diária, inclusive quando a consulta anterior concluiu com zero registros.
- **AC-6:** Falha antes da montagem do React exibe uma mensagem acionável no próprio HTML,
  nunca apenas o fundo azul, com recuperação explícita de cache/service worker.
- **AC-7:** O ErrorBoundary de topo também cobre os providers globais.
- **AC-8:** Arquivos estáveis de bootstrap (`index.html`, `service-worker.js` e
  `env-config.js`) não recebem cache imutável no Cloud Run nem no Vercel, e caches
  legados são removidos na ativação do service worker atual.

### Checklist da recorrência

- [x] Adicionar estado explícito `hasLoaded` ao hook do dashboard.
- [x] Manter conteúdo durante refetch nas três telas consumidoras.
- [x] Adicionar fallback pré-React e ação de recuperação do cliente.
- [x] Corrigir escopo do ErrorBoundary e política de cache dos artefatos de bootstrap.
- [x] Adicionar e executar testes de regressão direcionados.

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

### Implementação da recorrência

- `useDashboardData` agora expõe `hasLoaded`, separado de `array.length`, e preserva o
  último snapshot durante revalidação mesmo quando a consulta concluída está vazia.
- Caderneta, Dashboard e Cobrança diária só mostram o loader estrutural antes da
  primeira resposta. Refetch e falha transitória mantêm o conteúdo com status não
  destrutivo.
- O HTML entrega uma tela de bootstrap antes de qualquer dependência externa. Falha ou
  timeout anterior ao React mostra recuperação que remove Cache Storage/service workers
  e recarrega com cache-bust.
- O ErrorBoundary passou a envolver também o `ToastProvider`.
- Service worker remove caches legados na ativação; Nginx e Vercel revalidam os arquivos
  estáveis de bootstrap em vez de tratá-los como assets imutáveis.

## 4. File List

- `components/ErrorBoundary.tsx` (novo)
- `index.tsx`
- `components/DailyCollectionView.tsx`
- `components/LegacyContractPage.tsx`
- `components/QuickContractInput.tsx`

### File List da recorrência

- [x] `hooks/useDashboardData.ts`
- [x] `components/dashboard/CadernetaBullet.tsx`
- [x] `components/DailyCollectionView.tsx`
- [x] `components/Dashboard.tsx`
- [x] `index.tsx`
- [x] `index.html`
- [x] `public/service-worker.js`
- [x] `nginx.conf`
- [x] `vercel.json` (novo)
- [x] `e2e/regression/frontend-resilience.spec.ts` (novo)
- [x] `docs/stories/FIX-001-search-bars-blank-screen.story.md`

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

### QA da recorrência — 2026-08-03

- ✅ `npm run build` — build Vite concluído (2456 módulos).
- ✅ `npx tsc --noEmit` — sem erros de tipos.
- ✅ `npx playwright test e2e/regression/frontend-resilience.spec.ts --project=chromium --no-deps`
  — **4 passed**: bundle indisponível, Caderneta vazia, Dashboard vazio e Cobrança diária
  vazia durante refetch lento.
- ✅ `git diff --check` e validação JSON de `vercel.json`.
- ⚠️ Os comandos obrigatórios `npm run lint`, `npm run typecheck` e `npm test` foram
  executados, mas o `package.json` não define esses scripts. O equivalente de typecheck
  e os testes direcionados acima passaram; a lacuna de scripts permanece explícita.
- ⚠️ O smoke autenticado contra produção não foi repetido porque a credencial local de
  QA está inválida/expirada. Nenhuma escrita foi feita no ambiente do cliente.

**Gate da recorrência:** PASS para revisão/deploy; validar os headers e a recuperação no
domínio de produção após a publicação.

### Gate blindado e deploy — 2026-08-03

Solicitado um único comando local/CI que impeça deploy quando a resiliência do frontend
regredir. O gate deve ser independente de credenciais reais, não escrever no Supabase e
testar o bundle de produção em servidor isolado.

- [x] Adicionar scripts `lint`, `typecheck`, `test` e `test:resilience` ao `package.json`.
- [x] Validar estruturalmente fallback, ErrorBoundary, stale-while-revalidate e cache.
- [x] Construir `dist`, subir preview em porta efêmera e garantir cleanup via `trap`.
- [x] Bloquear/auditar qualquer request Supabase não mockada nos testes funcionais.
- [x] Integrar o gate crítico ao workflow de deploy antes dos testes com ambiente real.
- [x] Executar o gate completo.
- [x] Publicar somente o hotfix após o gate aprovado.
- [ ] Validar status do deploy e comportamento no endpoint publicado.

#### File List do gate/deploy

- [x] `package.json`
- [x] `playwright.config.ts`
- [x] `scripts/test-frontend-resilience.sh` (novo)
- [x] `scripts/validate-frontend-resilience.mjs` (novo)
- [x] `e2e/regression/frontend-resilience.spec.ts`
- [x] `.github/workflows/deploy.yml`
- [x] `docs/stories/FIX-001-search-bars-blank-screen.story.md`

#### Resultado local do gate blindado

- ✅ `npm run lint` — 13 invariantes estruturais verificadas, sem `.only` nos E2E.
- ✅ `npm run typecheck` — TypeScript sem erros.
- ✅ `npm run build` — bundle Vite de produção concluído.
- ✅ Validação do `dist` — entrada com hash, fallback pré-React e limpeza de caches presentes.
- ✅ Preview efêmero isolado, encerrado automaticamente ao final.
- ✅ Playwright — **4 passed**, Supabase apontado para domínio `.invalid` e zero requests
  inesperadas/não mockadas.

**Gate:** aprovado; deploy liberado pelo script.

#### Primeira publicação e correção do gate externo

- ✅ Commit isolado `773a33a` enviado para `main`; Vercel concluiu o deploy.
- ✅ GitHub Actions: gate isolado, auth, schema, Tier 1 e Tier 2 passaram; imagem e revisão
  Cloud Run foram publicadas.
- ❌ Smoke externo detectou `HTTP 403` no endpoint Cloud Run, apesar do job ter marcado
  sucesso: o workflow não garantia invocação pública.
- 🔧 Workflow endurecido com `--allow-unauthenticated`, binding explícito
  `allUsers → roles/run.invoker` e validação pós-deploy do HTML, fallback, bundle com hash,
  service worker e headers de cache. O deploy só fica verde quando o endpoint responde 200.
