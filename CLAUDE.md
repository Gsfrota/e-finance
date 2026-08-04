# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at http://localhost:3000
npm run build    # Production build (vite/esbuild) — ⚠️ NÃO faz typecheck
npx tsc --noEmit # Typecheck — GATE REAL do CI (roda antes do build no deploy); rode SEMPRE antes de pushar
npm run preview  # Preview production build (porta 4173, usada pelos e2e)
scripts/claude-agent.sh "seu prompt"  # Claude headless com JSON e MCP do Supabase
```

### E2E (Playwright)

```bash
npm run test:e2e          # Todos os testes (headless)
npm run test:e2e:ui       # UI interativa do Playwright
npm run test:e2e:headed   # Browser visível
npm run test:e2e:report   # Abrir relatório do último run
npm run test:qa           # scripts/pre-deploy-qa.sh (smoke tests pré-deploy)
```

Os testes ficam em `e2e/` organizados por role: `auth/`, `admin/`, `investor/`, `debtor/`, `payment/`, `edge-cases.spec.ts`. A autenticação é feita via `e2e/auth.setup.ts`, que persiste estado em `e2e/.auth/{role}.json`. Requer `preview` rodando na porta 4173 e variáveis em `.env.local`.

## Deploy & CI

O **web app** deploya no **Google Cloud Run** via `.github/workflows/deploy.yml` (gatilho: `push` na `main`; ignora `e-finance-bot/**`, `*.md`, `docs/**`). Prod: **`https://juroscerto.com`** (service `e-finance`, projeto `tribal-pillar-476701-a3`, região `us-west1`). O bot tem deploy próprio (`deploy-bot.yml`).

- O job `deploy` **depende** do job `test` (E2E Critical Gate), que roda nesta ordem: `npx tsc --noEmit` → `npm run build` → Playwright E2E (tiers 0/1/2).
- ⚠️ **`tsc --noEmit` quebrado CONGELA produção silenciosamente**: o job `test` falha → `deploy` vira *skipped* → o último build permanece no ar sem aviso óbvio. **Sempre rode `npx tsc --noEmit` antes de pushar** — `npm run build` (vite) NÃO typecheca.
- `tsconfig` usa `types: ["node"]` (sem `@types/react` nem `vite/client`): `import.meta.env` exige `vite-env.d.ts` (`/// <reference types="vite/client" />`); classes que estendem `React.Component` precisam declarar `props`/`state` explicitamente.
- Confirmar o que está REALMENTE no ar: comparar o hash do bundle (`curl -s https://juroscerto.com | grep -o 'assets/index-[^"]*\.js'`) ou buscar a string única de um fix no bundle baixado. Bundle minificado é ~1 linha → `grep -c` conta linhas (engana); prefira presença / `grep -o … | wc -l`.
- **`git push` / PR / merge / release / Cloud Run é autoridade EXCLUSIVA do @devops.**

## Environment

Supabase credentials are read from `window._env_` first, then from Vite env vars (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). In local development only, `localStorage` overrides (`EF_EXTERNAL_SUPABASE_URL` / `EF_EXTERNAL_SUPABASE_KEY`) are still accepted for manual testing.

**Database setup**: the current multi-company rollout is documented in `context/migration_v28_multi_company.sql` and `context/database_schema.md`. Always inspect the real Supabase schema before applying database changes.

## Claude Agent Wrapper

Use `scripts/claude-agent.sh` when you need Claude as a headless helper from the terminal.

- The wrapper emits JSON (`--output-format json`).
- On `pc1`, it locates the native Claude binary even when `claude` is not on the non-interactive `PATH`.
- If `SUPABASE_ACCESS_TOKEN` is available, it builds a temporary MCP config for Supabase and exposes `mcp__supabase__*` tools to the Claude session.
- Prefer short prompts with explicit scope and JSON output requirements.
- For schema changes, Claude is the guardião do banco: inspect the real Supabase schema first, ask for explicit agreement before any apply, and validate the database again after the migration.

## Architecture

**E-Finance** is a multi-tenant SaaS platform for managing lending contracts (investor → debtor), built with React 19 + TypeScript + Vite + Supabase.

### Data Model (core types in `types.ts`)

- **Tenant** — organization that owns the platform instance
- **Profile** — user with role `admin | investor | debtor`, always scoped to a `tenant_id`
- **Investment** — a lending contract between an investor (`user_id`) and debtor (`payer_id`). Tracks principal, interest rate, installment count, capital origin (`source_capital` = own money, `source_profit` = reinvested profit)
- **LoanInstallment** — individual payment rows for an Investment, with status `pending | paid | late | partial` and penalty fields (`fine_amount`, `interest_delay_amount`)
- **InvestorBalanceView** — SQL view (`view_investor_balances`) that aggregates wealth metrics per investor
- **Invite** — single-use invite codes for onboarding users into a tenant

### Request Flow

```
App.tsx (routing via AppView enum)
  └── Login.tsx / ResetPassword.tsx
  └── Dashboard.tsx  ← dispatches to admin-only views (non-admin gated at App.tsx)
        └── AdminUsers / AdminContracts / AdminSettings
```

All data fetching goes through custom hooks (`hooks/`) which call `services/supabase.ts`. The Supabase client is recreated when localStorage credentials change (see `getSupabaseClient()` pattern).

### Contract Creation Paths (⚠️ três caminhos independentes)

Existem **três** entradas para criar contrato, cada uma com sua própria validação/UI — **um fix em uma NÃO cobre as outras** (ex.: o fix de "permitir juros 0" #36 só tocou `AdminContracts`; o `LegacyContractPage` continuou bloqueando 0 e foi reportado como bug separado):

- `components/AdminContracts.tsx` — wizard principal ("Novo Contrato"), via RPC `create_investment_validated`.
- `components/QuickContractInput.tsx` — modal "Contrato Antigo" (aberto pelo AdminContracts), via `create_legacy_investment`; **deriva** o juros de `current_value - amount_invested` (sem input direto).
- `components/LegacyContractPage.tsx` — página cheia "Contrato Antigo" (`AppView.LEGACY_CONTRACT`), via `create_legacy_investment`; tem **input direto** de juros.

`Investment.status` (em `types.ts`): `'active' | 'completed' | 'defaulted' | 'renewed'`. **`completed` = contrato 100% quitado** (setado de fato no banco). O dashboard exclui parcelas de contratos `completed` (BR-CNT-011); a lista de contratos (`AdminContracts`) destaca `completed` com badge "QUITADO".

### Subscription Plans & Feature Gates

`Tenant.plan` pode ser `'free' | 'caderneta' | 'empresarial'`. A lógica de gates vive em `services/companyScope.ts`:

- **`isFreePlanLocked(tenant)`** — plano `free` sem trial ativo bloqueia `FREE_PLAN_BLOCKED_VIEWS` (Dashboard, Collection, Assistant, etc.)
- **`isTrialActive(tenant)`** — verifica `trial_ends_at` vs `Date.now()`
- **Multi-empresa** — só `empresarial` com `plan_status === 'active'` OU trial ativo pode acessar escopo agregado (`CompanyScope = 'all'`)
- **`isPlatformOwner`** — email `guifrotasouza@gmail.com` tem acesso irrestrito permanente

O `CompanyContextProvider` (em `App.tsx`) expõe via `useContext(CompanyContext)`: `tenant`, `profile`, `companies`, `activeCompanyScope`, `activeCompanyId`, `isEnterpriseTenant`, `isFreePlanLocked`, etc. Todos os componentes que precisam saber a empresa ativa devem consumir este contexto, não o estado local.

`CompanyScope = 'all' | string | null` — `'all'` é escopo agregado, `string` é `company_id`, `null` é sem empresa selecionada.

### Key Services

- `services/supabase.ts` — Supabase client factory + shared helpers (`isValidCPF`, `parseSupabaseError`, `logError`)
- `services/companyScope.ts` — Lógica de planos, gates de features, `CompanyContext`, helpers de escopo multi-empresa
- `services/cache.ts` — Cache em memória para queries do Supabase (evitar refetch desnecessário)
- `services/paymentAudit.ts` — Log de auditoria de pagamentos

### Path Alias

`@/` resolves to the project root (defined in `vite.config.ts`).

### Language

UI strings and comments are in **Portuguese (Brazilian)**. Error messages from `parseSupabaseError` are in PT-BR. Keep this consistent when modifying existing components.

## Development Workflow (OBRIGATÓRIO)

**Toda** solicitação de mudança, feature, bug ou melhoria segue este fluxo:

### Story Development Cycle (SDC)

Padrão principal para 95% das mudanças:

```
@pm (create epic)
  └── @sm (create story from epic)
      └── @po (validate story - 10pt checklist)
          └── @dev (implement code)
              └── @qa (quality gate - 7 checks)
                  └── @devops (git push + merge)
```

**Referência:**
- Fases detalhadas: `.claude/rules/workflow-execution.md` → "Story Development Cycle"
- Checklists: `.claude/rules/story-lifecycle.md`
- Autoridade de agentes: `.claude/rules/agent-authority.md`

---

## When to Call Each Agent

### 📊 By Task Type

| Task | Agent | Command |
|------|-------|---------|
| **Report bug** | `@qa` | Triagem + classification |
| **Test feature** | `@qa` | Quality gate (`*qa-gate`) |
| **Implement code** | `@dev` | Development (`*develop-story`) |
| **Architecture/Design** | `@architect` | System design decisions |
| **Database schema** | `@data-engineer` | DDL + optimization |
| **Research/Analysis** | `@analyst` | Investigation (`*brainstorm`) |
| **UX/UI design** | `@ux-design-expert` | Design patterns + mockups |
| **Create epic** | `@pm` | Requirements (`*create-epic`) |
| **Create story** | `@sm` | From epic (`*create-story`) |
| **Validate story** | `@po` | 10-point checklist (`*validate-story-draft`) |
| **Git push/PR/Release** | `@devops` | Exclusive authority (`*push`) |
| **Framework work** | `@aios-master` | Any meta task |

### 📅 By Workflow Phase

1. **Epic Creation** → `@pm *create-epic` (gather requirements, write spec)
2. **Story Creation** → `@sm *create-story` (from epic/PRD)
3. **Story Validation** → `@po *validate-story-draft` (10-point checklist)
4. **Implementation** → `@dev *develop-story` (code + local tests)
5. **QA Gate** → `@qa *qa-gate` (7 quality checks, E2E validation)
6. **QA Loop** (if issues) → `@qa *qa-loop` + `@dev fixes` (iterative, max 5)
7. **Push to Main** → `@devops *push` (exclusive)

### ⚠️ Exclusive Operations (DO NOT DELEGATE)

| Operation | Exclusive Agent |
|-----------|-----------------|
| `git push` / force push | `@devops` |
| `gh pr create` / merge | `@devops` |
| MCP add/remove | `@devops` |
| CI/CD pipeline | `@devops` |
| `*create-epic` | `@pm` |
| `*validate-story-draft` | `@po` |
| `*create-story` | `@sm` |

**Reference:** `.claude/rules/agent-authority.md`

---

## Database Schema Changes (GATES OBRIGATÓRIOS)

Para qualquer mudança em schema ou RPC:

1. **Inspect** real schema com `scripts/claude-agent.sh`
2. **Get explicit approval** do usuário antes de aplicar
3. **Validate** após aplicação

**Claude é o guardião do banco.** Nunca aplicar migration sem acordo explícito.

---

## Exception: Questions & Analysis

Mensagens classificadas como **QUESTION** (como funciona X, explicar Y, analisar Z)
não ativam o workflow — são respondidas diretamente.

---

## Reference

Regras completas em `.claude/rules/`:
- **workflow-execution.md** — 4 primary workflows (SDC, QA Loop, Spec Pipeline, Brownfield)
- **story-lifecycle.md** — 10-point validation checklist + 7 QA checks
- **agent-authority.md** — Delegation matrix + exclusive operations
- **agent-handoff.md** — Context compaction on agent switch
