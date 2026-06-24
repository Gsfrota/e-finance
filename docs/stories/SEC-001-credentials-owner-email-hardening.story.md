# SEC-001 — Remover credenciais do git + bloquear escalada de privilégio via owner_email

**Agentes:** @qa (auditoria) → @dev → @qa → @devops
**Status:** InReview
**Criada em:** 2026-06-24
**Prioridade:** P0 — exploitável agora por qualquer pessoa com acesso ao repositório
**Complexidade:** S (3 arquivos, sem migration, sem lógica nova)
**Banco:** sem mudança de schema (apenas bloqueio de campo editável via UI)
**Valor:** Elimina exposição permanente de credenciais de produção e fecha vetor de escalada de privilégio

---

## 1. Problema

Dois vetores de ataque identificados na auditoria de segurança (2026-06-24):

**CRIT-3 — Credenciais de produção no histórico git:**
`public/env-config.js` contém `SUPABASE_URL` e `SUPABASE_ANON_KEY` hardcoded e commitados
no HEAD (JWT com expiração até 2036). Qualquer pessoa com acesso ao repositório pode
consultar ou enumerar o banco de produção diretamente. O `docker-entrypoint.sh` já
injeta os valores em runtime via Cloud Run — os valores hardcoded são completamente
desnecessários.

**CRIT-4 — Privilege escalation via `owner_email`:**
`AdminSettings.tsx:238` inclui `owner_email` no objeto `updates` enviado ao banco,
tornando o campo editável por qualquer admin da plataforma. `companyScope.ts:86` verifica
`isPlatformOwner` comparando `tenant.owner_email === 'guifrotasouza@gmail.com'` client-side,
sem validação server-side. Vetor: admin malicioso edita o campo via UI → ganha acesso
irrestrito ao `AppView.PLATFORM_OWNER` com dados de todos os tenants e controle de planos.

## 2. Acceptance Criteria

- **AC-1:** `public/env-config.js` contém apenas `window._env_ = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };` — sem nenhum valor real de produção.
- **AC-2:** `public/env-config.js` está listado em `.gitignore` — novos commits não podem incluir o arquivo acidentalmente.
- **AC-3:** O campo `owner_email` NÃO aparece no objeto `updates` em `AdminSettings.tsx` — o campo não é mais editável via UI por admins.
- **AC-4:** `npm run build` passa sem erros após as alterações.
- **AC-5:** (manual/devops) A anon key de produção foi rotacionada no painel Supabase (Settings → API → Regenerate) após o deploy.

## 3. Implementação

**AC-1 e AC-2 — `public/env-config.js` + `.gitignore`:**
- Substituir o conteúdo de `public/env-config.js` pelo placeholder vazio
- Adicionar `public/env-config.js` ao `.gitignore`
- O arquivo precisa continuar existindo em `public/` para o Vite não quebrar o `<script src="/env-config.js">` em dev local — mas vazio. Em produção, o `docker-entrypoint.sh` o gera dinamicamente.

**AC-3 — `AdminSettings.tsx:238`:**
- Remover `owner_email` do objeto `updates`. O campo pode continuar sendo exibido na UI como read-only (para referência), mas não deve ser enviado no `.update()`.

**Fora de escopo desta story:**
- Mover a verificação `isPlatformOwner` para RPC server-side (CRIT-4 completo) — esse trabalho requer migration e é story separada (SEC-002).
- Adicionar política RLS bloqueando UPDATE em `owner_email` — idem, story separada.
- Rotação da anon key — responsabilidade do @devops no deploy.

**Riscos:**
- `git rm --cached` remove o arquivo do tracking futuro, mas **as credenciais permanecem no histórico git**. Qualquer `git clone` ou `git log -p` ainda expõe as chaves. Por isso a rotação da anon key pelo @devops (AC-5) é **obrigatória e bloqueante** — não é opcional.
- Se `env-config.js` for removido do git sem o placeholder existir em `public/`, o build local quebra (`<script src="/env-config.js">` em `index.html`). O arquivo deve existir com conteúdo vazio, apenas fora do tracking git.

## 4. File List

- [x] `public/env-config.js` — substituir por placeholder vazio
- [x] `.gitignore` — adicionar linha `public/env-config.js`
- [x] `components/AdminSettings.tsx` — remover `owner_email` do objeto `updates` (~linha 238)

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 `env-config.js` placeholder | ✅ Verificado: contém apenas strings vazias |
| AC-2 `.gitignore` | ✅ Verificado: linha `public/env-config.js` presente |
| AC-3 `owner_email` fora do `updates` | ✅ Verificado: objeto `updates` contém apenas `owner_name` |
| AC-4 `npm run build` | ✅ Build verde (exit code 0) |
| AC-5 Rotação anon key | ⏳ Pendente @devops no deploy |

**Observações:**
- `owner_email` ainda aparece em `AdminSettings.tsx` como read-only (state display + `SubscriptionTab`) — correto e intencional conforme escopo da story.
- As credenciais permanecem no histórico git histórico (antes do commit de limpeza). @devops deve executar a rotação da anon key no painel Supabase **antes** de qualquer deploy — AC-5 é bloqueante para produção.
