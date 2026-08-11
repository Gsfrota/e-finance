# PWA Offline — Fase 0: cortar as dependências de CDN

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app renderizar com estilo completo sem nenhuma requisição a servidor de terceiro, que é pré-requisito de qualquer funcionamento offline.

**Architecture:** O Tailwind sai do Play CDN (que compila classes em runtime no navegador) e passa a ser gerado no build pelo PostCSS, com a config JS migrada 1:1 do `index.html`. As fontes Inter e Playfair Display saem do Google Fonts e passam a vir do pacote `@fontsource`, servidas junto com o bundle. Uma verificação no gate de lint impede que qualquer URL externa volte para o `index.html`.

**Tech Stack:** Tailwind CSS v3 (mesma major que o Play CDN entrega hoje — migrar para v4 é outra mudança, com breaking changes visuais), PostCSS, Autoprefixer, `@fontsource/inter`, `@fontsource/playfair-display`, Vite 6.

**Contexto verificado (não re-investigar):**
- O app usa **Tailwind v3**: `cdn.tailwindcss.com` + `tailwind.config = {...}`. O Play CDN do v4 usa outra URL (`@tailwindcss/browser@4`) e config via `@theme` em CSS.
- **Zero classes construídas dinamicamente.** As 216 ocorrências de template string em `className` usam classes completas dentro de variáveis e ternários — todas detectáveis pelo scanner do Tailwind. Não há padrão `text-${cor}-500`.
- O Vite **processa** o `index.css` mesmo entrando por `<link rel="stylesheet" href="/index.css">`: no build ele sai como `dist/assets/index-<hash>.css`.
- `scripts/validate-frontend-resilience.mjs` roda como `npm run lint`, expõe `assertCheck(condition, message)` e aceita a flag `--dist`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `tailwind.config.js` (criar) | Tema e paths de scan. Recebe a config hoje inline no `index.html` |
| `postcss.config.js` (criar) | Liga Tailwind e Autoprefixer ao pipeline do Vite |
| `index.css` (modificar) | Ganha as diretivas `@tailwind` no topo e os imports das fontes |
| `index.html` (modificar) | Perde o script do CDN, a config inline e os três links do Google Fonts |
| `package.json` (modificar) | Ganha as dependências de build |
| `scripts/validate-frontend-resilience.mjs` (modificar) | Ganha a checagem que proíbe URL externa — o teste de regressão |

---

## Task 1: O gate que proíbe URL externa (teste primeiro)

Esta task escreve a verificação **antes** da correção. Ela deve falhar no fim da task — é isso que prova que o teste tem valor.

**Files:**
- Modify: `scripts/validate-frontend-resilience.mjs`

- [ ] **Step 1: Adicionar a checagem no gate**

Inserir imediatamente antes do bloco `if (failures.length > 0) {`, no nível superior do arquivo. A variável `indexHtml` já existe nesse escopo — é lida no destructuring do topo.

```js
// Offline (Fase 0): nenhuma dependência de terceiro pode voltar ao HTML.
// Sem rede, um <script> ou <link> externo deixa o app sem estilo ou sem boot.
const externalHosts = [...new Set(
  [...indexHtml.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1]),
)];

assertCheck(
  externalHosts.length === 0,
  `index.html não pode carregar recurso de terceiro (encontrado: ${externalHosts.join(', ') || 'nenhum'})`,
);
```

- [ ] **Step 2: Rodar o gate e confirmar que ele FALHA**

Run: `npm run lint`

Expected: falha com
`✗ index.html não pode carregar recurso de terceiro (encontrado: cdn.tailwindcss.com, fonts.googleapis.com, fonts.gstatic.com)`

Se passar, a regex está errada — corrigir antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-frontend-resilience.mjs
git commit -m "test(lint): gate proíbe recurso de terceiro no index.html

Falha de propósito: hoje o app carrega Tailwind e fontes de CDN, o que
deixa a interface sem estilo nenhum quando não há rede."
```

---

## Task 2: Tailwind e PostCSS locais

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`

- [ ] **Step 1: Instalar as dependências**

Run: `npm install -D tailwindcss@^3.4.0 postcss@^8.4.0 autoprefixer@^10.4.0`

Expected: `package.json` ganha as três em `devDependencies`.

- [ ] **Step 2: Criar `tailwind.config.js` com a config migrada 1:1**

O tema abaixo é cópia exata do objeto `tailwind.config` que hoje está inline no `index.html`. Não alterar valores — qualquer diferença muda a aparência do app em produção.

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
      },
      colors: {
        ink: {
          950: '#0a1020',
          900: '#0f1d33',
          850: '#172540',
          800: '#1c2d4d',
          700: '#223558',
          600: '#2e4470',
        },
        brass: {
          300: '#f5c842',
          400: '#f0b429',
          500: '#d49a18',
          600: '#b07f10',
        },
        sage: {
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
        },
        rust: {
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
        },
        steel: {
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Criar `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tailwind.config.js postcss.config.js
git commit -m "build(tailwind): instala Tailwind v3 local com a config migrada do index.html

Mesma major que o Play CDN entrega hoje, e tema copiado valor a valor —
migrar para v4 traz breaking changes visuais e é outra mudança."
```

---

## Task 3: Diretivas do Tailwind no CSS

**Files:**
- Modify: `index.css:1`

- [ ] **Step 1: Inserir as diretivas no topo do `index.css`**

Antes da linha `:root {`, inserir:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

As 590 linhas existentes ficam intactas abaixo — são CSS puro com variáveis e continuam válidas.

- [ ] **Step 2: Verificar que o CSS gerado contém utilitários do Tailwind**

Run: `npm run build && grep -c 'flex\|rounded-full' dist/assets/*.css`

Expected: número maior que zero. Se der zero, o PostCSS não rodou — conferir se `postcss.config.js` está na raiz e usa `export default` (o projeto é ESM, `"type": "module"`).

- [ ] **Step 3: Commit**

```bash
git add index.css
git commit -m "build(tailwind): diretivas base/components/utilities no index.css"
```

---

## Task 4: Fontes auto-hospedadas

**Files:**
- Modify: `package.json`
- Modify: `index.css:1`

- [ ] **Step 1: Instalar os pacotes de fonte**

Run: `npm install @fontsource/inter@^5 @fontsource/playfair-display@^5`

- [ ] **Step 2: Importar exatamente os pesos que o app usa**

No topo do `index.css`, **acima** das diretivas `@tailwind`, inserir:

```css
/* Pesos idênticos aos que o Google Fonts servia:
   Inter 400/500/600/700 e Playfair Display 500/600/700. */
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';
@import '@fontsource/playfair-display/500.css';
@import '@fontsource/playfair-display/600.css';
@import '@fontsource/playfair-display/700.css';
```

`@import` precisa vir antes de qualquer outra regra, incluindo as diretivas do Tailwind.

- [ ] **Step 3: Confirmar que os arquivos de fonte entraram no build**

Run: `npm run build && ls dist/assets/*.woff2 | head -5`

Expected: arquivos `.woff2` listados. Se não houver nenhum, os `@import` não foram resolvidos — conferir se os pacotes estão em `dependencies` e o caminho está correto.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json index.css
git commit -m "build(fonts): auto-hospeda Inter e Playfair Display via @fontsource

Mesmos pesos que o Google Fonts servia. Sem rede, o app mantém a
tipografia em vez de cair no fallback do sistema."
```

---

## Task 5: Remover o CDN do index.html

**Files:**
- Modify: `index.html:65-67` (links do Google Fonts)
- Modify: `index.html` (script do CDN e a config inline)

- [ ] **Step 1: Remover os três links do Google Fonts**

Apagar as linhas:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Remover o script do CDN e a config inline**

Apagar `<script src="https://cdn.tailwindcss.com"></script>` e todo o bloco `<script>` que define `tailwind.config = { ... }` — o conteúdo dele já vive em `tailwind.config.js` desde a Task 2.

- [ ] **Step 3: Rodar o gate e confirmar que agora PASSA**

Run: `npm run lint`

Expected: `✓ index.html não pode carregar recurso de terceiro (encontrado: nenhum)`

- [ ] **Step 4: Confirmar que o build não referencia mais host externo**

Run: `grep -o 'https://[a-z0-9.-]*' dist/index.html | sort -u`

Expected: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "build: remove Tailwind CDN e Google Fonts do index.html

O CSS agora é gerado no build e as fontes vêm do bundle. Sem rede, o app
renderiza com estilo — pré-requisito da Frente B (offline)."
```

---

## Task 6: Verificação de que nada quebrou visualmente

O risco desta fase não é o app parar de funcionar — é ele ficar visualmente diferente. Estas verificações existem para pegar isso.

**Files:** nenhum (só verificação)

- [ ] **Step 1: Typecheck e build**

Run: `npx tsc --noEmit && npm run build`

Expected: ambos sem erro. `tsc --noEmit` é o gate real do CI.

- [ ] **Step 2: Rodar a suíte de resiliência**

Run: `npm test`

Expected: `5 passed` e `Gate de resiliência aprovado: deploy liberado.`

- [ ] **Step 3: Conferir o tamanho do CSS gerado**

Run: `ls -la dist/assets/*.css`

Expected: o arquivo deve crescer em relação ao build anterior (~10 kB antes, dezenas de kB agora), porque agora ele contém os utilitários que o CDN gerava em runtime. Um arquivo que **não** cresceu indica que o Tailwind não escaneou os componentes — revisar o `content` do `tailwind.config.js`.

- [ ] **Step 4: Conferência visual no preview**

Run: `npm run preview` e abrir `http://localhost:4173`

Verificar, com a aba Network em modo offline após o primeiro load:
- A tipografia continua Inter no corpo e Playfair nos títulos.
- As cores de marca (dourado do `--accent-brass`, azul do header) estão iguais.
- Nenhuma requisição para `cdn.tailwindcss.com` ou `fonts.g*` no Network.

- [ ] **Step 5: Commit final se houver ajuste**

Se algo precisou ser corrigido:

```bash
git add -A
git commit -m "fix(build): ajustes da migração do Tailwind para build local"
```

---

## Definition of Done

- `npm run lint` passa, incluindo a nova checagem anti-terceiro.
- `npx tsc --noEmit` limpo.
- `npm test` verde (5 testes de resiliência).
- `grep https:// dist/index.html` não retorna nada.
- O app renderiza idêntico ao anterior, verificado no preview.

## Fora do escopo desta fase

- Service Worker e cache offline (Entrega 2).
- IndexedDB, fila de baixas e `offline_payment_intents` (Entrega 3).
- Migração para Tailwind v4 — traz breaking changes visuais e não é pré-requisito de offline.
- O `nginx.conf`, resíduo do Cloud Run desativado, e o proxy `/api-proxy/` órfão no Service Worker: ambos saem na Entrega 2, junto com a reescrita do SW.
