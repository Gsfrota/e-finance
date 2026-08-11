# PWA Offline — Entrega 2: o app abre e mostra a carteira sem rede

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sem rede, o app abre e mostra a carteira do último sync, deixando claro há quanto tempo aquele dado foi atualizado.

**Architecture:** Um Service Worker com cache em runtime — network-first para navegação, cache-first para assets com hash — substitui o SW atual, que hoje apaga todos os caches. O cache de dados **já existe** (`services/cache.ts`, em localStorage, com timestamp) e o `useDashboardData` já hidrata a partir dele; o trabalho é expor a idade do dado e parar de tratar falha de rede como erro fatal.

**Tech Stack:** Service Worker (Cache API), localStorage via `services/cache.ts`, React 19, Vite 6.

**Contexto verificado (não re-investigar):**
- `services/cache.ts` **já persiste em localStorage** com TTL de 5 min e devolve `{ data, stale }`. Não é cache em memória, apesar do que o CLAUDE.md diz.
- `useDashboardData` (`hooks/useDashboardData.ts:231-247`) **já hidrata do cache** no estado inicial, marcando `isStale: true`, e grava com `setCached` na linha 439.
- O SW atual (`public/service-worker.js`, 37 linhas) apaga **todos** os caches no `activate` e faz proxy do Gemini para `/api-proxy/`. Esse proxy é órfão: só existe no `nginx.conf`, resíduo do Cloud Run desativado. Nenhum código do app chama.
- O `index.html` registra o SW no `load` (linha ~203) e tem o `[AppRecovery]`, que mostra "limpe o cache do aplicativo" se o React não montar em **15s**. É manual e não toca IndexedDB/localStorage.
- Assets de build saem com hash (`/assets/index-<hash>.js`), então são imutáveis e seguros para cache-first.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `public/service-worker.js` (reescrever) | Cache do app shell. Network-first em navegação, cache-first em asset com hash |
| `services/cache.ts` (modificar) | Passa a expor `fetchedAt` junto com `data`/`stale` |
| `hooks/useOnlineStatus.ts` (criar) | Hook mínimo de estado da conexão, reaproveitável |
| `components/OfflineBanner.tsx` (criar) | Faixa fixa com estado da conexão e idade do dado |
| `index.html` (modificar) | `[AppRecovery]` deixa de sugerir "limpe o cache" quando o problema é falta de rede |
| `nginx.conf` (deletar) | Resíduo do Cloud Run desativado |

---

## Task 1: Service Worker que serve o app offline

**Files:**
- Rewrite: `public/service-worker.js`

- [ ] **Step 1: Substituir o conteúdo inteiro do arquivo**

```js
// service-worker.js — cache do app shell para funcionamento offline.
//
// REGRA DURA: este arquivo só mexe na Cache API. Nunca em localStorage nem em
// IndexedDB — é lá que vivem o snapshot da carteira e, na Entrega 3, a fila de
// baixas ainda não sincronizadas. Apagar isso é apagar dinheiro registrado.

const CACHE = 'ef-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Remove apenas caches de versões ANTERIORES deste app.
      caches.keys().then((names) => Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Só mexe no que é nosso. Supabase e qualquer outra origem passam direto —
  // dado de API não entra em cache de shell.
  if (url.origin !== self.location.origin) return;

  // Navegação: tenta a rede primeiro (para pegar deploy novo), cai no cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached
          || new Response('Sem conexão e sem cópia local do app.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }))),
    );
    return;
  }

  // Assets com hash são imutáveis: cache primeiro, rede só na primeira vez.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
```

- [ ] **Step 2: Build e subir o preview**

Run: `npm run build && npx vite preview --port 4173 &`

- [ ] **Step 3: Provar que o app abre offline**

Este é o teste que define a entrega. Script em `/tmp/.../verify-offline.mjs`:

```js
import { chromium } from '/home/guilherme/projetos/e-finance/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 1ª visita ONLINE: o SW instala e enche o cache.
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
await page.waitForTimeout(2000);

// Agora derruba a rede e recarrega.
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const r = await page.evaluate(() => ({
  temRoot: !!document.querySelector('#root')?.children.length,
  texto: document.body.innerText.slice(0, 120),
  fonte: getComputedStyle(document.body).fontFamily,
}));
console.log(JSON.stringify(r, null, 2));
await browser.close();
if (!r.temRoot) { console.error('✗ app não renderizou offline'); process.exit(1); }
if (!r.fonte.includes('Inter')) { console.error('✗ CSS não veio do cache'); process.exit(1); }
console.log('✓ app abre e renderiza offline');
```

Run: `node /tmp/.../verify-offline.mjs`

Expected: `✓ app abre e renderiza offline`

- [ ] **Step 4: Commit**

```bash
git add public/service-worker.js
git commit -m "feat(pwa): service worker que serve o app offline

Substitui o SW que apagava todos os caches no activate — resíduo do Google
AI Studio. Agora: network-first em navegação (pega deploy novo), cache-first
em asset com hash (imutável). Origem externa passa direto: dado de API não
entra em cache de shell.

Regra dura registrada no arquivo: o SW só mexe na Cache API, nunca em
localStorage ou IndexedDB, onde vivem o snapshot e a futura fila de baixas."
```

---

## Task 2: Expor a idade do dado

**Files:**
- Modify: `services/cache.ts:9-21`
- Test: `tests/unit/cache.test.ts` (criar)

- [ ] **Step 1: Escrever o teste primeiro**

Criar `tests/unit/cache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCached, setCached } from '@/services/cache';

describe('cache — idade do dado', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('devolve fetchedAt junto com os dados', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11, 8, 0, 0));
    setCached('k', { valor: 1 });

    const lido = getCached<{ valor: number }>('k');
    expect(lido?.data).toEqual({ valor: 1 });
    expect(lido?.fetchedAt).toBe(new Date(2026, 7, 11, 8, 0, 0).getTime());
  });

  it('marca stale depois do TTL de 5 minutos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11, 8, 0, 0));
    setCached('k', { valor: 1 });

    vi.setSystemTime(new Date(2026, 7, 11, 8, 5, 1));
    expect(getCached('k')?.stale).toBe(true);
  });

  it('devolve null quando não há nada guardado', () => {
    expect(getCached('inexistente')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- cache`

Expected: FAIL — `fetchedAt` é `undefined`.

- [ ] **Step 3: Adicionar `fetchedAt` ao retorno**

Em `services/cache.ts`, trocar a assinatura e o retorno de `getCached`:

```ts
export function getCached<T>(key: string): { data: T; stale: boolean; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    const stale = Date.now() - entry.timestamp > CACHE_TTL;
    return { data: entry.data, stale, fetchedAt: entry.timestamp };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- cache`

Expected: 3 passed.

- [ ] **Step 5: Verificar que o vitest tem localStorage**

Se os testes falharem com `localStorage is not defined`, o ambiente do vitest é node. Adicionar em `vitest.config.ts`, dentro de `test`:

```ts
environment: 'jsdom',
```

E instalar: `npm i -D jsdom`.

- [ ] **Step 6: Commit**

```bash
git add services/cache.ts tests/unit/cache.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(cache): expõe fetchedAt para a UI mostrar a idade do dado"
```

---

## Task 3: Estado da conexão

**Files:**
- Create: `hooks/useOnlineStatus.ts`

- [ ] **Step 1: Criar o hook**

```ts
import { useEffect, useState } from 'react';

/**
 * Estado da conexão, com os eventos nativos do navegador.
 * `navigator.onLine` é otimista — diz que há rede quando existe interface
 * ativa, mesmo sem internet de verdade. Serve para o caso comum (modo avião,
 * sinal caindo na rua) e é o que a Entrega 2 precisa.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const ficouOnline = () => setOnline(true);
    const ficouOffline = () => setOnline(false);
    window.addEventListener('online', ficouOnline);
    window.addEventListener('offline', ficouOffline);
    return () => {
      window.removeEventListener('online', ficouOnline);
      window.removeEventListener('offline', ficouOffline);
    };
  }, []);

  return online;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add hooks/useOnlineStatus.ts
git commit -m "feat(pwa): hook de estado da conexão"
```

---

## Task 4: Faixa de offline com a idade do dado

**Files:**
- Create: `components/OfflineBanner.tsx`
- Modify: `components/Dashboard.tsx` (montar o banner no topo)

- [ ] **Step 1: Criar o componente**

```tsx
import React from 'react';
import { CloudOff, Clock } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineBannerProps {
  /** Momento do último dado carregado do servidor (epoch ms). */
  fetchedAt?: number | null;
}

function descreverIdade(fetchedAt: number): string {
  const minutos = Math.floor((Date.now() - fetchedAt) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.floor(horas / 24)}d`;
}

/**
 * Mostra que o app está sem rede e há quanto tempo o dado na tela foi
 * atualizado. Fica escondido quando está tudo normal — barulho constante vira
 * ruído que o operador aprende a ignorar.
 */
const OfflineBanner: React.FC<OfflineBannerProps> = ({ fetchedAt }) => {
  const online = useOnlineStatus();
  if (online) return null;

  const idade = fetchedAt ? descreverIdade(fetchedAt) : null;
  const velho = fetchedAt ? Date.now() - fetchedAt > 24 * 60 * 60 * 1000 : false;

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold ${
        velho
          ? 'bg-[rgba(239,68,68,0.16)] text-[color:var(--accent-negative)]'
          : 'bg-[rgba(240,180,41,0.14)] text-[color:var(--accent-brass)]'
      }`}
    >
      <CloudOff size={13} />
      <span>Sem conexão</span>
      {idade && (
        <>
          <Clock size={12} />
          <span>dados atualizados {idade}</span>
        </>
      )}
    </div>
  );
};

export default OfflineBanner;
```

- [ ] **Step 2: Montar no Dashboard**

Em `components/Dashboard.tsx`, importar e renderizar acima do conteúdo, passando o `fetchedAt` que vem de `useDashboardData`.

- [ ] **Step 3: Typecheck e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add components/OfflineBanner.tsx components/Dashboard.tsx
git commit -m "feat(pwa): faixa de offline com a idade do dado na tela"
```

---

## Task 5: `[AppRecovery]` para de mandar limpar o cache sem rede

**Files:**
- Modify: `index.html` (função `__EF_SHOW_BOOT_ERROR__`)

- [ ] **Step 1: Diferenciar falta de rede de app quebrado**

Na função `__EF_SHOW_BOOT_ERROR__`, antes de montar a mensagem, checar a conexão e trocar o texto:

```js
var semRede = ('onLine' in navigator) && navigator.onLine === false;
document.getElementById('app-boot-title').textContent =
  semRede ? 'Sem conexão' : 'Não foi possível abrir o sistema';
document.getElementById('app-boot-copy').textContent = semRede
  ? 'Você está sem internet e este aparelho ainda não tem uma cópia do sistema salva. Conecte-se uma vez para poder usar offline depois.'
  : 'Uma versão antiga pode ter ficado salva neste aparelho. Limpe o cache do aplicativo e tente novamente.';
document.getElementById('app-boot-recover').hidden = semRede;
```

O `hidden = semRede` é o ponto central: **sem rede, o botão de limpar cache não aparece**. Era ele que faria um cobrador em campo apagar o próprio app.

- [ ] **Step 2: Verificar que o gate continua passando**

Run: `npm run lint`

Expected: gate aprovado, incluindo a checagem anti-terceiro.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix(pwa): sem rede, o boot não sugere limpar o cache

O [AppRecovery] mostrava 'limpe o cache do aplicativo' após 15s sem montar o
React. Sem sinal, um cobrador em campo clicaria e apagaria a cópia local do
app. Agora a tela distingue os dois casos e esconde o botão quando é só
falta de rede."
```

---

## Task 6: Remover os resíduos do Cloud Run — **NÃO EXECUTADA, por decisão do Step 1**

O próprio Step 1 mandava parar se algo referenciasse o arquivo. E referencia:

- `scripts/validate-frontend-resilience.mjs:53,64,127` — o gate **lê e valida** o `nginx.conf`
- `docker-entrypoint.sh:8,18` — gera o `env-config.js` e sobe o nginx
- `README.md` — documenta a arquitetura de deploy

Deletar o arquivo vira uma limpeza de toda a superfície Docker (Dockerfile, entrypoint, gate, README), que não é pré-requisito de offline e tem risco próprio. Fica registrado como pendência: **o app migrou para a Vercel e o Cloud Run está desativado, então essa superfície inteira é resíduo** — mas a remoção merece frente própria.

## Task 6 (original, preservada para a frente futura)

**Files:**
- Delete: `nginx.conf`

- [ ] **Step 1: Confirmar que nada referencia o arquivo**

Run: `rg -n 'nginx' --glob '!node_modules' --glob '!dist' .`

Expected: só o próprio `nginx.conf` e menções em documentação. Se o `Dockerfile` referenciar, parar e reavaliar — ele pode ainda servir ao bot.

- [ ] **Step 2: Deletar**

Run: `git rm nginx.conf`

- [ ] **Step 3: Typecheck, build e suíte**

Run: `npx tsc --noEmit && npm run build && npm test && npm run test:unit`

Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git rm nginx.conf
git commit -m "chore: remove nginx.conf, resíduo do Cloud Run desativado

O proxy /api-proxy/ que ele servia era a outra ponta do handler de Gemini que
saiu do service-worker.js. Nenhum código do app chama."
```

---

## Definition of Done

- O app **abre e renderiza offline** depois de uma visita online, comprovado por script com `setOffline(true)`.
- A faixa de offline aparece sem rede, com a idade do dado, e some quando a conexão volta.
- Sem rede, a tela de erro de boot **não** oferece limpar o cache.
- `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run test:unit` verdes.
- Nenhuma requisição a origem externa além do Supabase.

## Fora do escopo desta entrega

- Fila de baixas, `offline_payment_intents` e a RPC de idempotência — Entrega 3.
- Qualquer escrita offline.
- Push notification e Background Sync.
- `navigator.storage.persist()` — entra na Entrega 3, junto com a fila que ele protege.
