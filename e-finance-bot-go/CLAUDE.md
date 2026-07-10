# e-finance-bot-go

Reescrita em Go do bot do e-finance. Roda **ao lado** do `e-finance-bot/` (TS), que fica como
referência e rollback. Design completo: `../docs/superpowers/specs/2026-07-02-go-rewrite-design.md`
(+ addendum do canal web: `../docs/superpowers/specs/2026-07-09-web-chat-channel.md`).

## Princípios (não-negociáveis)

- **stdlib-first, zero frameworks.** Única `interface` do projeto = `gemini.Client`. Um function type
  não é interface. Sem interface `Channel` — a entrega é return-based (`pipeline.Handle` retorna `Reply`).
- **Minimizar Gemini ao máximo** (decisão do usuário, 10/07): caminho determinístico primeiro; router
  regex-first, LLM só como fallback; **naturalização de resposta DESLIGADA por default** (`LLM_RESPONSE_ENABLED=false`);
  cache de LLM agressivo (30s); transcrição/imagem só quando há áudio/imagem de fato. Cada chamada Gemini é custo — justifique.
- **Estado quente em memória exige `--max-instances=1`**; só o que precisa sobreviver a restart vai pro banco.

## Deploy: Railway (decisão do usuário, 10/07)

Host = **Railway** (não Cloud Run — o Cloud Run do projeto morreu; ver `[[project_vercel_migration]]`).
Container always-on + público (webhooks WhatsApp/Telegram + `POST /chat` do canal web, com CORS pra origin
da Vercel). Precisa: `Dockerfile` (multi-stage → distroless static) + config Railway (env vars/secrets) +
`DATABASE_URL` (DSN do pooler Supabase). O `deploy-bot.sh`/`deploy-bot-go.sh` da spec (gcloud) **não** se aplica
— será substituído por deploy Railway. SPA fica na Vercel; bot no Railway; Postgres+auth no Supabase.

## Verdictos do M0 (verificados via MCP em prod, 09–10/07 — não reinvestigar)

- **pgx-direto funciona** apesar de `create_investment_validated`/`create_legacy_investment` usarem `auth.uid()`:
  - `auth.uid()` aparece só em (1) um **guard de tenant** `IF auth.uid() IS NOT NULL AND p_tenant_id <> get_tenant_id_safe()`
    → sob pgx service-role (sem JWT) `auth.uid()` é NULL, o guard **no-opa**. Seguro porque o bot enforça tenant na
    própria camada (tenant do AuthContext, nunca dos args do NLU).
  - (2) **ator do audit log** → sob pgx vira **NULL** (cosmético). `// ponytail: aceitar actor NULL no v1; SET LOCAL request.jwt.claims se atribuição de auditoria importar.`
  - Identidade real vem sempre dos params explícitos: `p_tenant_id`, `p_user_id`, `p_payer_id`.
- **RPCs core** (`SELECT func($1,...)`): `create_investment_validated`→int8, `create_legacy_investment`→int8,
  `pay_installment(uuid, numeric, timestamptz)`→void. Todas `SECURITY DEFINER`.
- **Auth do canal web / API Go**: JWT do Supabase é **ES256/JWKS** (não HS256 legado); `iss`=`.../auth/v1`,
  `aud`=`authenticated`; mapear `sub`→profile por `profiles.auth_user_id` (nullable→403); papel de negócio de
  `profiles.role`, nunca do claim `role`. Ver `[[reference_efinance_supabase_mcp]]`.

## Layout (conforme a spec cresce)

```
cmd/spike/    # M0 DESCARTÁVEL: prova pgx + genai local (apagar após M1)
cmd/bot/      # (M1+) binário real: config → pgxpool → mux → ListenAndServe
internal/     # (M1+) config, httpapi, channel, pipeline, router, nlu, tools, store, gemini, scheduler, fmtbr, msgs
tests/blackbox/  # (M3+) a bateria — o GATE do corte
```

## Comandos

```bash
go run ./cmd/spike     # M0: sobe um Postgres local (docker) antes — ver abaixo
go build ./...
go test ./...
```

Postgres local pro spike/testes:
`docker run -d --rm --name efbot-spike-pg -e POSTGRES_PASSWORD=spike -p 55432:5432 postgres:16-alpine`
