# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation (tsc)
npm run start        # Run compiled output
npm run test         # Run all tests once (vitest run)
npm run test:watch   # Tests in watch mode
npm run test:coverage # Coverage report
```

No path aliases — all imports use relative paths or bare module names.

## Architecture

**E-Finance Bot** is a WhatsApp + Telegram chatbot for the E-Finance SaaS platform. It receives webhook messages, processes them through a multi-stage NLU pipeline, executes business actions against Supabase, and replies via channel APIs.

### Request Flow (20-stage pipeline)

```
Webhook (WhatsApp/Telegram)
  └── src/index.ts  (dedup → rate-limit → inbound buffer)
        └── src/handlers/message-handler.ts  (full pipeline orchestration)
              ├── session-manager  (link user profile to chat)
              ├── prompt-guard     (injection detection)
              ├── audio-pipeline   (speech-to-text via Gemini)
              ├── confirmation-store  (resolve pending "sim"/"não")
              ├── followup-resolver   (contextual short replies, e.g., "e em 3?")
              ├── command-understanding  (smalltalk, shortcuts)
              ├── intent-router    (80+ regex rules → Gemini fallback)
              ├── intent-classifier (entity extraction: CPF, amount, rate…)
              ├── action-planner   (ClassifiedIntent → ActionPlan)
              ├── policy-engine    (role/tenant auth gate)
              ├── tool-executor    (run query or mutation against Supabase)
              └── response-generator  (ActionPlan result → natural PT-BR text)
```

### Key Source Directories

| Path | Purpose |
|------|---------|
| `src/index.ts` | Express app, routes, inbound buffer, dedup, rate-limit |
| `src/config.ts` | All env vars with defaults — single source of truth |
| `src/handlers/message-handler.ts` | Full pipeline orchestration (~670 lines) |
| `src/ai/` | NLU layer: `intent-router` (hybrid regex+LLM), `intent-classifier` (entity extraction), `response-generator` (LLM naturalization), `audio-pipeline` |
| `src/assistant/` | Stateful assistant layer: `capability-registry`, `action-planner`, `tool-executor`, `followup-resolver`, `confirmation-store`, `working-state-store`, `policy-engine`, `time-window` |
| `src/actions/admin-actions.ts` | ~1850-line business logic: dashboard, contracts, installments, payments, user search |
| `src/channels/` | WhatsApp (UazAPI) + Telegram integrations |
| `src/session/session-manager.ts` | Profile linking, conversation history, context persistence |
| `src/scheduler/` | Cloud Scheduler morning briefing |

### NLU Strategy

Hybrid two-stage approach to minimize LLM latency:
1. **`intent-router.ts`** — 80+ regex rules cover common intents; cache (30s TTL) prevents redundant LLM calls; falls back to Gemini when confidence is low (2s timeout, 80 token max)
2. **`intent-classifier.ts`** — extracts entities (debtor name, CPF, BRL amount, interest rate, installment count) using regex + Gemini for complex/ambiguous cases
3. **`response-generator.ts`** — converts deterministic `ActionPlan` results to conversational Portuguese (2.2s timeout, 80 token max)

### Assistant Layer Contracts

`src/assistant/contracts.ts` defines the shared types:
- `ActionCapability` — 24 capabilities with role matrix (admin/investor/debtor) and confirmation requirements
- `ActionPlan` — resolved capability + extracted args + ambiguity info
- `ConversationWorkingState` — session-scoped state (30min TTL) stored in `bot_sessions.context.workingState`

`capability-registry.ts` is the source of truth for what each role can do. `policy-engine.ts` enforces it pre-execution.

### Channels & Formatting

- **WhatsApp** — UazAPI webhook; text formatting via plain text/markdown
- **Telegram** — Bot API; HTML parse mode for rich text
- Presence simulation ("typing...") runs before every reply

### Database

Uses the parent project's Supabase schema (see `../context/database_schema.md`, currently v16). Key tables: `profiles`, `investments`, `loan_installments`, `bot_sessions`, `bot_tenant_configs`. All queries are tenant-scoped via Supabase RLS.

### Environment

Required env vars (all from Google Secret Manager in production):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `UAZAPI_SERVER_URL`, `UAZAPI_INSTANCE_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `SCHEDULER_SECRET` — has trailing newline in Secret Manager; `config.ts` trims it

### Deployment

```bash
./deploy-bot.sh            # Build Docker, push to Artifact Registry, deploy Cloud Run
./deploy-bot.sh --skip-tests
```

Service: `e-finance-bot` | Region: `us-west1` | Project: `tribal-pillar-476701-a3`

After deploy: re-register UazAPI webhook with explicit events (see `docs/CONFIGURACAO.md`).

### Key Behavioral Notes

- Messages where `fromMe: true` are silently dropped (`src/index.ts`) — affects testing via API
- Inbound buffer aggregates rapid messages (3.5s debounce, 12s max, 5-message limit) before processing
- `bot_sessions.context.workingState` persists disambiguation state across turns (30min TTL)
- Sensitive mutations (e.g., marking payment) require explicit confirmation reply before execution
