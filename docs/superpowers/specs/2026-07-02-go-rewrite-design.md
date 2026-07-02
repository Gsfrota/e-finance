# Reescrita em Go — e-finance (bot primeiro, depois API)

## Contexto

O e-finance (juroscerto.com) foi vibecodado e acumula bugs em produção — inclusive no bot WhatsApp (vazamento de dia-vencimento entre contextos, sem cap de taxa de juros, confirmações pendentes "pegajosas"). O usuário quer reescrever em Go para ter uma base sólida. Sistema em produção com tenants reais: web app React 19 SPA (~38.6k linhas) falando direto com Supabase, bot Node/TS no Cloud Run (~19.3k src + ~13.9k testes), lógica de negócio em 22 RPCs SQL.

## Decisões tomadas com o usuário

1. **Escopo**: bot em Go + depois API Go entre React e banco. Frontend React fica.
2. **Supabase fica** como Postgres + auth (API Go validará JWT do Supabase).
3. **Ordem**: bot primeiro; API do web app é fase posterior (esboço na Parte B).
4. **Desenho novo em Go** — descarta a migração "Core Engine TS" em andamento.
5. **Go**: primeira linguagem do usuário → stdlib-first, zero frameworks, 1 única interface no projeto (`gemini.Client`). Claude implementa.
6. **Cutover: corte seco** — bateria black-box verde → troca a URL dos webhooks de uma vez. Rollback = repontar webhooks pro bot TS (fica deployado intocado ≥30 dias).

**Corte de escopo declarado**: o modo experimental "AI-native" (conversation-orchestrator.ts, atrás de flag com default off) NÃO é portado na v1 — vira milestone próprio se desejado.

## Parte A — Bot em Go

### A1. Layout: `e-finance-bot-go/` no mesmo repo

Go module autocontido; bot TS fica ao lado como referência e rollback. ~12 pacotes rasos:

```
e-finance-bot-go/
├── cmd/bot/main.go             # wiring: config → pgxpool → mux → ListenAndServe
├── internal/
│   ├── config/                 # struct única de env (mesmos nomes de env var do config.ts)
│   ├── httpapi/                # mux Go 1.22+ ("POST /webhook/whatsapp/{secret}"), webhooks, /setup, /health, /debug/traces
│   ├── channel/                # outbound: whatsapp.go (uazapi), telegram.go, presence.go
│   ├── pipeline/               # Handle(ctx, Inbound) — 8 estágios; buffer.go (debounce memória), guard.go
│   ├── router/                 # patterns.go (tabela de regras portada das 80+ regex), llm_fallback.go
│   ├── nlu/                    # entities.go — ÚNICO lugar de extração: CPF, R$, %, datas PT-BR, parcelas
│   ├── tools/                  # registry (map literal) + 1 arquivo/domínio (quebra o admin-actions.ts de 2675 L)
│   ├── store/                  # pgx: sessions, messages, dedup, confirmations, linkcodes, tenantconfig, traces, domain
│   ├── gemini/                 # interface Client + impl real (fake em tests/)
│   ├── scheduler/              # briefing, followup/EOD, promotions, subscription, announcements
│   ├── fmtbr/                  # ÚNICO lugar de formatação moeda/data
│   └── msgs/                   # templates PT-BR
├── tests/blackbox/             # a bateria (A5)
├── Dockerfile                  # multi-stage → distroless static
└── deploy-bot-go.sh            # clone do deploy-bot.sh (SERVICE=e-finance-bot-go, gate go test)
```

### A2. Stack

| Necessidade | Escolha |
|---|---|
| HTTP server/client | `net/http` stdlib (method routing Go 1.22+) |
| Postgres | `pgx/v5` + pgxpool direto no pooler do Supabase. RPCs viram `SELECT create_investment_validated($1,...)`. ⚠️ pooler transaction-mode (6543) quebra prepared statements → `default_query_exec_mode=simple_protocol` ou session-mode (5432). Pool 4 conns |
| Gemini | `google.golang.org/genai` (SDK oficial) — router fallback, transcrição áudio, imagem; `responseSchema` p/ JSON |
| Logs | `log/slog` JSONHandler (Cloud Logging parseia severity) |
| Validação | structs + funções manuais nas fronteiras (sem lib) |

**supabase-go/PostgREST rejeitado**: wrapper comunitário, +latência, sem transações. pgx é o padrão maçante.

### A3. Redesenho do estado (corrige os 3 bugs por desenho)

Infra: **`--max-instances=1 --memory=256Mi`** — Go aguenta o tráfego com folga; memória volta a ser segura para estado quente. Só o que precisa sobreviver a restart vai pro banco.

| Estado | Go | Nota |
|---|---|---|
| Dedup de mensagem | **Postgres**: nova tabela `bot_processed_updates(channel, external_id, processed_at, PK(channel,external_id))`, `INSERT ON CONFLICT DO NOTHING`; limpeza 48h nos jobs | sobrevive a restart |
| Confirmações pendentes | **Postgres**: nova tabela `bot_pending_confirmations(id, session_id, tenant_id, profile_id, action jsonb, created_at, expires_at, consumed_at)` + índice único parcial `(session_id) WHERE consumed_at IS NULL`; leitura só com `expires_at > now()`; msg que não é sim/não consome como "superseded" | **corrige bug "pegajoso"** |
| workingState da sessão | mantém `bot_sessions.context`, mas vira struct tipada com `Draft` escopado por intent — intent de kind diferente zera o draft | **corrige vazamento de dia-vencimento** |
| Cap de taxa | validação central em `tools/validate.go`: `0 < taxa ≤ MAX_MONTHLY_RATE_PCT` (env, default 20) antes da RPC | **corrige falta de cap**; follow-up fase 2: CHECK no banco |
| Rate-limit, buffer/debounce, cache LLM 30s | memória | `// ponytail: exige max-instances=1; se escalar, tabela bot_inbound_buffer` |

**Migration única** (2 tabelas novas, nada existente muda) — segue o gate do projeto: inspecionar schema real via MCP, aprovação explícita do usuário antes de aplicar, validação depois.

### A4. Pipeline (20 estágios TS → 8 em Go) e tools

```
decode → dedup+drop(fromMe) → buffer → session/linking/rate-limit → enrich(guard, áudio, imagem)
→ resolve(confirmação → followup → router regex → LLM fallback → nlu) → execute(tool+policy+confirm) → respond(template → naturalização LLM opcional 80tok → save → send)
```

Tool sem registry mágico:
```go
type Tool struct {
    Name    string
    Roles   []Role  // admin/investor/debtor — substitui capability-registry + policy-engine
    Confirm bool    // mutação sensível → fluxo de confirmação
    Run     func(ctx context.Context, env Env, args map[string]any) (Result, error)
}
```
Arquivos por domínio: queries_dashboard, queries_receivables, queries_debtor, contracts, payments, users, config, utility.

**Router**: slice ordenada de `{intent, *regexp.Regexp}` — primeira que casa ganha, portada 1:1 do TS. ⚠️ RE2 não tem lookaround: regex reescritas onde preciso; o port do `intent-router.test.ts` (80+ casos) é quem garante equivalência. Fallback LLM: Gemini Flash Lite, responseSchema, timeout 2s, cache 30s, prompts portados verbatim.

**Schedulers**: mesmos 5 endpoints POST /scheduler/* com `x-scheduler-secret`; Cloud Scheduler só muda de URL no corte.

### A5. Bateria black-box — O GATE

Bot Go sobe como binário real, configurado por env para mundo fake:
- **Postgres**: `supabase start` local aplicando as migrations reais + seeds SQL por caso (plano B se frágil: postgres em Docker + schema extraído)
- **Gemini**: `FAKE_GEMINI=1` → fake determinístico da interface; naturalização desligada (`LLM_RESPONSE_ENABLED=false`) → resposta = template determinístico
- **uazapi/Telegram**: `httptest.Server` capturando outbound (nova env `TELEGRAM_API_BASE`)
- `INBOUND_BUFFER_DEBOUNCE_MS=0`

Table-driven: `flow{Seed .sql, Chat, Steps[]{In, WantContains[], WantSQL}}` — multi-turn na mesma sessão; **`WantSQL` asserta side-effect real no banco** (descoberta da exploração: os testes TS mockam tudo; os mocks viram seeds SQL).

Portagem dos oráculos: intent-router.test.ts → teste unitário da tabela de regras (primeiro verde); message-handler/probe-create/baixa/view/contract-flows → flows black-box; **+ casos novos obrigatórios para os 3 bugs**.

**Critério de aprovação do corte seco:**
1. 100% bateria determinística verde (`go test ./tests/blackbox/ -count=1`)
2. Todas asserções `WantSQL` verdes (nenhuma mutação fantasma/faltante)
3. Smoke ao vivo: ~10 conversas roteirizadas com Gemini real em staging, aprovadas pelo usuário
4. Schedulers disparados manualmente em staging ≡ comportamento do TS

### A6. Milestones (~9–12 dias de implementação)

| M | Entrega | Pronto quando | Esforço |
|---|---|---|---|
| M0 | Spike: pgx→pooler, SELECT das 3 RPCs em branch DB; hello-world genai Go | cmd descartável roda ambos | 0,5d |
| M1 | Esqueleto: config, slog, mux /health+webhooks 200; Dockerfile; deploy Cloud Run | curl /health em prod | 0,5–1d |
| M2 | store + decode webhooks + linking + echo bot | vincular chat de teste real | 1d |
| M3 | Tabela de regras + nlu + tools de consulta + templates | port intent-router verde + flows de consulta verdes | 2–3d |
| M4 | Mutações + confirmations pg + policy + drafts (com os 3 bug-fixes) | probe-create/baixa + casos dos 3 bugs verdes | 2–3d |
| M5 | 5 schedulers | POST manual em staging ≡ TS | 1d |
| M6 | Áudio + imagem + prompt guard + presence | caso de áudio verde + nota de voz manual | 1d |
| M7 | Bateria completa + smoke ao vivo + **corte** | critérios A5 batidos; webhooks+schedulers repontados | 1–2d |

### A7. Deploy e corte

Dockerfile multi-stage (golang:1.24-alpine → distroless/static). `deploy-bot-go.sh` clona deploy-bot.sh: mesmo projeto (tribal-pillar-476701-a3), região southamerica-east1, secrets do Secret Manager + novo `DATABASE_URL` (DSN pooler). Gate `go test ./...`.

**Checklist do corte (reversível em minutos):**
1. Bateria + smoke verdes
2. uazapi: webhook da instância → URL do serviço Go
3. Telegram: setWebhook → URL nova
4. `gcloud scheduler jobs update http` × 5
5. Observar logs/traces 24–48h; rollback = passos 2–4 de volta; TS intocado ≥30 dias

## Parte B — API Go do web app (esboço; vira plano próprio após bot estável)

Serviço novo `e-finance-api-go/` (mesmo repo, mesmo padrão stdlib+pgx), strangler **por rota** — React continua no Supabase para o que não migrou (RLS segue ativa).

- **Auth**: middleware valida JWT do Supabase (JWKS cacheado; HS256 legado → JWT secret). Tenant explícito no SQL (`WHERE tenant_id=$1`), não recriar RLS via claims.
- **React**: `services/api.ts` — fetch com `Authorization: Bearer ${session.access_token}`; migração call-site a call-site (`supabase.rpc(...)` → `api.post(...)`).
- **Ordem de estrangulamento**: (1) leituras pesadas de cálculo — useInvestorMetrics/useDashboardData/useDebtorFinance viram GET /api/dashboard etc. (1 fonte de verdade que o bot Go também consome); (2) pay_installment (10 call sites) → POST /api/installments/{id}/pay, depois create_investment_validated, surplus/remainder, refinance, reverts; (3) cauda: platform_*, onboarding; stripe-webhook por último ou nunca.

## Riscos (top 5)

1. **PostgREST service-role ≠ pgx direto** (RPC dependendo de claims/auth.uid()) → M0 existe só pra isso, antes de qualquer pipeline.
2. **Oráculo TS mocka tudo** → bateria asserta side-effects no banco (WantSQL) + smoke com Gemini real + corte reversível.
3. **Regex JS → RE2 sem lookaround** → port do intent-router.test.ts verde ANTES dos flows; regra sem teste não entra.
4. **Estado em memória vs escala** → --max-instances=1 travado no script; dedup/confirmations já nascem no Postgres; upgrade path nomeado em comentário ponytail.
5. **Primeira codebase Go do usuário** → stdlib-first, 1 interface, pacotes rasos, CLAUDE.md do e-finance-bot-go com mapa + fluxo dos 8 estágios; bateria como documentação executável.

## Arquivos críticos (referência na implementação)

- `e-finance-bot/src/handlers/message-handler.ts` (2450 L) — pipeline a consolidar
- `e-finance-bot/src/ai/intent-router.ts` (809 L) — 80+ regex → tabela de regras
- `e-finance-bot/src/actions/admin-actions.ts` (2675 L) — lógica de negócio → tools/ por domínio
- `e-finance-bot/tests/message-handler.test.ts` + probe-*.test.ts — oráculos; mocks viram seeds SQL
- `e-finance-bot/deploy-bot.sh` — base do deploy-bot-go.sh

## Verificação

- **Por milestone**: critério "pronto quando" da tabela A6 (cada um verificável por comando ou teste manual roteirizado).
- **Gate do corte**: os 4 critérios de A5.
- **Pós-corte**: observar bot_turn_traces e logs Cloud Run 24–48h; smoke em prod com o tenant-sandbox de QA (skill prod-smoke-test); os 3 bugs conhecidos re-testados em prod.
- **Primeiro passo após aprovação**: gravar este design em `docs/superpowers/specs/2026-07-02-go-rewrite-design.md` e commitar (fluxo brainstorming), depois M0.
