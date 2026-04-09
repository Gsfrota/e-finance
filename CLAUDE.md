# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at http://localhost:3000
npm run build    # TypeScript check + production build
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
  └── Dashboard.tsx  ← dispatches to role-specific view
        ├── AdminUsers / AdminContracts / AdminSettings
        ├── InvestorDashboard  ← useInvestorMetrics hook
        └── DebtorDashboard    ← useDebtorFinance hook
```

All data fetching goes through custom hooks (`hooks/`) which call `services/supabase.ts`. The Supabase client is recreated when localStorage credentials change (see `getSupabaseClient()` pattern).

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
- `services/pix.ts` — Generates PIX payment strings (Brazilian instant payment standard); used with `qrcode.react` in `PaymentModal.tsx`
- `services/cache.ts` — Cache em memória para queries do Supabase (evitar refetch desnecessário)
- `services/paymentAudit.ts` — Log de auditoria de pagamentos

### Path Alias

`@/` resolves to the project root (defined in `vite.config.ts`).

### Language

UI strings and comments are in **Portuguese (Brazilian)**. Error messages from `parseSupabaseError` are in PT-BR. Keep this consistent when modifying existing components.

## Development Workflow (OBRIGATÓRIO)

**Toda** solicitação de mudança, feature, bug ou melhoria DEVE seguir o fluxo definido em `.claude/rules/e-finance-dev-workflow.md`.

### Resumo do Fluxo

```
Solicitação → @po BR Gate → @sm Draft → @po Validate → @dev Implement → @qa Gate → @devops Push
```

### Regra Principal

Antes de escrever qualquer linha de código:
1. **@po** verifica se há Business Rule em `docs/business-rules/e-finance-br.md`
2. Se não houver, **@po** elabora proposta e apresenta ao usuário
3. Usuário aprova ou ajusta a BR
4. Só então o desenvolvimento começa

### Exceção: Perguntas e Análises

Mensagens classificadas como QUESTION (como funciona X, explicar Y, analisar Z)
não ativam o fluxo — são respondidas diretamente.

### Gates de Banco de Dados

Para qualquer mudança em schema ou RPC:
1. Inspecionar schema real com `scripts/claude-agent.sh`
2. Obter confirmação explícita do usuário antes de aplicar
3. Validar após aplicação

**Claude é o guardião do banco.** Nunca aplicar migration sem acordo explícito.

### Referência Completa

Ver `.claude/rules/e-finance-dev-workflow.md` para:
- Tabela completa de triggers por tipo de mensagem
- Paralelismo permitido vs sequencial obrigatório
- Gates específicos do domínio financeiro (pagamentos, multi-tenant)
- Formato de documentação de novas BRs
