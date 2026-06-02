# FEAT-001 — Versão do sistema visível em Configurações

**Agentes:** @qa (spec) → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-06-02
**Prioridade:** P1 — suporte/diagnóstico (saber se o cliente está na build atualizada)
**Banco:** sem mudança de schema/RPC

---

## 1. Problema / Necessidade

Ao investigar bugs reportados por clientes (ex.: "tela fica azul"), não há como saber
se o cliente está rodando a **versão atualizada** do sistema. Precisamos expor a versão
(commit do deploy) e a data do build em **Configurações**, para comparar com o commit
do deploy (que já é notificado no Telegram).

## 2. Acceptance Criteria

- **AC-1:** A tela de Configurações (admin) exibe a versão do sistema e a data/hora do build.
- **AC-2:** Em produção a versão = commit do deploy (`github.sha`, 7 chars), igual ao do
  Telegram de deploy; em dev = short SHA do git local; fallback `dev` se indisponível.
- **AC-3:** Valores injetados em build-time (sem chamada de rede/runtime).
- **AC-4:** `npx tsc --noEmit` verde (gate de CI).

## 3. Implementação

- `vite.config.ts` — `define` injeta `__APP_VERSION__` (env `COMMIT_SHA`/`VITE_APP_VERSION`/
  `GITHUB_SHA` → senão `git rev-parse --short HEAD` → senão `dev`) e `__BUILD_TIME__` (ISO).
- `global.d.ts` (novo) — declara as constantes globais para o TS.
- `Dockerfile` — `ARG COMMIT_SHA` + `ENV COMMIT_SHA` antes do `npm run build`.
- `.github/workflows/deploy.yml` — `--build-arg COMMIT_SHA=${{ github.sha }}` no docker build.
- `components/AdminSettings.tsx` — rodapé "Versão do sistema {sha} · atualizado em {data}".

## 4. File List

- `vite.config.ts`
- `global.d.ts` (novo)
- `Dockerfile`
- `.github/workflows/deploy.yml`
- `components/AdminSettings.tsx`

## 5. QA Results

- ✅ AC-1/AC-3: na UI (sandbox) o rodapé exibe `Versão do sistema 3293a85 · atualizado em
  02/06/2026, 19:53` (SHA injetado em build-time).
- ✅ AC-2: localmente resolve via git; em prod via build-arg `COMMIT_SHA=github.sha`.
- ✅ AC-4: `npx tsc --noEmit` exit 0; `npm run build` verde; string presente no bundle.

**Gate:** PASS.
