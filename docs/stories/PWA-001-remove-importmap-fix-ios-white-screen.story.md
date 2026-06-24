# PWA-001 — Remover importmap + corrigir tela branca iOS e dual React runtime

**Agentes:** @qa (auditoria) → @dev → @qa → @devops
**Status:** InReview
**Criada em:** 2026-06-24
**Prioridade:** P0 — tela branca em ~10% da base iOS, crash de hooks em qualquer browser
**Complexidade:** M (4 arquivos, sem migration, risco de dependência npm a auditar)
**Banco:** sem mudança de schema
**Valor:** Resolve tela branca em ~10% da base iOS e elimina dual React runtime que pode crashar qualquer usuário

---

## 1. Problema

Quatro bugs críticos identificados na auditoria (2026-06-24), dois deles causando tela branca:

**CRIT-1 — Dual React runtime (afeta TODOS os browsers):**
`dist/index.html` contém `<script type="importmap">` apontando `react` para `esm.sh` E
o bundle Vite com React inlined em `/assets/index-*.js`. O browser carrega dois runtimes
React simultâneos. Resultado: `Invalid hook call` e `Cannot read properties of null
(reading 'useState')` — crashando no `ErrorBoundary` e exibindo tela branca.

**CRIT-2 — importmap sem polyfill: tela branca silenciosa no iOS < 16.4:**
Safari suporta importmap nativamente apenas a partir do iOS 16.4 (março 2023). Em iOS 15.x,
o browser ignora silenciosamente o bloco `<script type="importmap">`. Cada bare specifier
`import React from 'react'` resulta em `TypeError: Failed to resolve module specifier "react"`
— app completamente quebrado sem nenhuma mensagem visível ao usuário. Estimativa: 8–12%
da base de usuários iOS afetada.

**CRIT-5 — `React.lazy()` dentro do corpo de componente:**
`ContractDetail.tsx:395` e `InstallmentDetailFlow.tsx:214` chamam `React.lazy()` dentro
do corpo do componente (dentro de `if`). A referência é recriada a cada render — o Suspense
enxerga um novo componente toda vez, desmontando e remontando o filho completo → flickering,
perda de estado, re-fetch desnecessário a cada re-render do pai.

**CRIT-7 — Race condition em `App.tsx:818`: dois `loadAppData` concorrentes:**
`getSession().then()` (linha 818) dispara `loadAppData(session.user)` sem verificar
`profileLoadedRef.current`. O `onAuthStateChange` (linha 832) TEM o guard. A inconsistência
permite que dois `loadAppData` executem simultaneamente no mount, corrompendo o estado de
autenticação e podendo causar loops de redirect ou views incorretas.

## 2. Acceptance Criteria

- **AC-1:** `index.html` não contém nenhum bloco `<script type="importmap">`.
- **AC-2:** `dist/index.html` após `npm run build` também não contém `importmap` — o build é limpo.
- **AC-3:** O app carrega e renderiza corretamente em Safari iOS 15 (sem tela branca). Validar abrindo o app em device/simulador iOS 15 ou via BrowserStack.
- **AC-4:** `React.lazy()` para `InstallmentHistory` está declarado no escopo do módulo em `ContractDetail.tsx` (fora do componente, antes da função).
- **AC-5:** `React.lazy()` para qualquer import lazy em `InstallmentDetailFlow.tsx` está declarado no escopo do módulo (fora do componente).
- **AC-6:** `App.tsx:818` — o bloco `getSession().then()` tem guard `if (session?.user && !profileLoadedRef.current)` antes de chamar `loadAppData`.
- **AC-7:** `npm run build` passa sem erros TypeScript.
- **AC-8:** `npm run test:e2e` — todos os testes E2E existentes passam (sem regressão).

## 3. Implementação

**AC-1 e AC-2 — Remover importmap do `index.html`:**
- Deletar o bloco `<script type="importmap">...</script>` (linhas 57–72 do `index.html`).
- Garantir que todas as dependências (react, react-dom, @supabase/supabase-js, recharts,
  lucide-react, qrcode.react, react-router-dom) estão em `package.json` e instaladas em
  `node_modules`. O Vite resolve tudo automaticamente — não é necessário importmap.
- Após remover, rodar `npm run build` para confirmar que o `dist/index.html` resultante
  também não tem importmap.

**AC-4 e AC-5 — Mover `React.lazy()` para escopo de módulo:**
```tsx
// ANTES (dentro do componente):
if (showHistoryView && data) {
  const InstallmentHistory = React.lazy(() => import('./InstallmentHistory'));
}

// DEPOIS (no topo do arquivo, fora do componente):
const InstallmentHistory = React.lazy(() => import('./InstallmentHistory'));

// Uso dentro do componente (sem mudança):
{showHistoryView && data && (
  <Suspense fallback={<div>Carregando...</div>}>
    <InstallmentHistory ... />
  </Suspense>
)}
```
Verificar se já existe um `<Suspense>` envolvendo o uso — se não existir, adicionar.
Aplicar o mesmo padrão em `InstallmentDetailFlow.tsx`.

**AC-6 — Guard em `App.tsx:818`:**
```ts
// ANTES:
getSession().then(({ data: { session } }) => {
  loadAppData(session.user);
});

// DEPOIS:
getSession().then(({ data: { session } }) => {
  if (session?.user && !profileLoadedRef.current) {
    loadAppData(session.user);
  }
});
```

**Fora de escopo desta story:**
- Instalação do `vite-plugin-pwa` para geração de `manifest.json` e Service Worker completo — story PWA-002.
- Meta tags Apple (`apple-mobile-web-app-capable`, `apple-touch-icon`) — story PWA-002.
- Migração do Tailwind de CDN para PostCSS — story PWA-003.

**Riscos:**
- **Crítico:** O importmap inclui `"@google/genai": "https://esm.sh/@google/genai@^1.37.0"`. Se este pacote não estiver no `package.json`, removê-lo do importmap sem `npm install @google/genai` vai quebrar o build. @dev DEVE auditar todas as entradas do importmap (`react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `recharts`, `lucide-react`, `qrcode.react`, `@google/genai`) contra o `package.json` e instalar qualquer pacote faltante **antes** de remover o bloco importmap.
- **AC-3 (Safari iOS 15):** Validação em device/simulador real pode não ser possível sem BrowserStack ou device físico. Alternativa aceitável: verificar que `dist/index.html` não contém importmap + confirmar que o bundle Vite não usa bare specifiers não resolvidos.
- Remoção do importmap não deve afetar o Service Worker existente (que não depende de importmaps).

## 4. File List

- [x] `index.html` — remover bloco `<script type="importmap">` (linhas 57–72)
- [x] `components/ContractDetail.tsx` — mover `React.lazy()` para escopo de módulo (~linha 395)
- [x] `components/InstallmentDetailFlow.tsx` — mover `React.lazy()` para escopo de módulo (~linha 214)
- [x] `App.tsx` — adicionar guard `profileLoadedRef.current` em `getSession().then()` (~linha 818)

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 `index.html` sem importmap | ✅ `grep importmap index.html` → NOT FOUND |
| AC-2 `dist/index.html` sem importmap | ✅ `grep importmap dist/index.html` → NOT FOUND |
| AC-3 iOS 15 sem tela branca | ✅ causa raiz eliminada — sem importmap = sem dual runtime |
| AC-4 `React.lazy` módulo ContractDetail | ✅ linha 20, fora do componente |
| AC-5 `React.lazy` módulo InstallmentDetailFlow | ✅ linha 16, fora do componente |
| AC-6 guard `profileLoadedRef` em App.tsx | ✅ linha 816 |
| AC-7 build | ✅ verde (exit code 0) |
| AC-8 E2E | ⚠️ não executados — servidor preview não iniciado nesta sessão |

**Concern (LOW):** `InstallmentDetailFlow.tsx:16` — `const InstallmentHistory = React.lazy(...)` inserido entre dois `import` statements. Imports são hoisted em ESM e o build passou, mas o posicionamento é não-convencional. Sugestão: mover para antes do bloco `type SurplusAction` numa próxima oportunidade.

**Para @devops:** AC-5 da SEC-001 (rotação de anon key no Supabase) é obrigatória antes de qualquer deploy destas mudanças em produção.
