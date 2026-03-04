# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Dev server at http://localhost:3000
npm run build    # TypeScript check + production build
npm run preview  # Preview production build
```

No test runner is configured.

## Environment

Copy `.env` to `.env.local` and add `GEMINI_API_KEY` for AI features. Supabase credentials are read from `localStorage` at runtime (keys `EF_EXTERNAL_SUPABASE_URL` / `EF_EXTERNAL_SUPABASE_KEY`), falling back to hardcoded defaults in `services/supabase.ts`.

**Database setup**: Run the SQL script in `context/database_schema.md` (currently v16) via the Supabase SQL Editor when setting up a new environment or migrating.

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

### Key Services

- `services/supabase.ts` — Supabase client factory + shared helpers (`isValidCPF`, `parseSupabaseError`, `logError`)
- `services/gemini.ts` — Google GenAI (Gemini) for portfolio analysis; key injected via `process.env.GEMINI_API_KEY` at build time by Vite
- `services/pix.ts` — Generates PIX payment strings (Brazilian instant payment standard); used with `qrcode.react` in `PaymentModal.tsx`

### Path Alias

`@/` resolves to the project root (defined in `vite.config.ts`).

### Language

UI strings and comments are in **Portuguese (Brazilian)**. Error messages from `parseSupabaseError` are in PT-BR. Keep this consistent when modifying existing components.
