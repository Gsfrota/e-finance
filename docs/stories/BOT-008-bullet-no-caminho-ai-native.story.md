# BOT-008 — Bullet no caminho AI-native (paridade com a capability)

**Agentes:** @pm → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review (QA PASS; aguardando @devops push/deploy)
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01 (follow-up de BOT-005)
**Prioridade:** P0 — feature BOT-005 não chega a 4/6 tenants (os que rodam AI-native)
**Banco:** sem mudança de schema/RPC

---

## 1. Contexto / problema

Confirmado em produção: `AI_NATIVE_ENABLED=true` (sem allowlist) + `bot_tenant_config.ai_enabled`
por tenant → **4 de 6 tenants rodam o caminho AI-native** (`conversation-orchestrator`
+ `src/ai/tools/handlers.ts`). O BOT-005 (bullet) foi implementado na camada
**capability** (`executors/*`), que serve só os 2 tenants legados. No AI-native, a tool
`create_contract` e os handlers não conhecem `calculation_mode`/rolagem/quitação → criar
bullet criaria contrato **padrão** e a baixa não ofereceria juros/quitar.

## 2. Insight de arquitetura (reuso)

A execução **confirmada** ("sim") converge: `message-handler` monta `confirmedPlan` a
partir do `argsSnapshot` e chama `executeActionPlan` → **capability executor** (onde o
bullet já existe e está testado). Logo, o AI-native só precisa: (a) deixar o LLM
expressar bullet, (b) preview bullet-aware, (c) **propagar `calculation_mode`/`bullet_mode`
no `argsSnapshot`** — a execução reusa a lógica do BOT-005.

## 3. Acceptance Criteria

- **AC-1:** Tool `create_contract` (AI-native) aceita `calculation_mode: 'interest_only'`;
  o handler gera preview bullet ("Juros simples — prazo indeterminado", juros/período,
  sem total linear) e põe `calculation_mode` no `argsSnapshot`.
- **AC-2:** "sim" cria bullet de verdade (executeActionPlan → capability → RPC
  `create_investment_validated` com `interest_only`).
- **AC-3:** Tool `mark_installment_paid` aceita `bullet_mode`; ao baixar parcela de
  contrato bullet, o handler pergunta **juros vs quitar** antes do preview; com
  `bullet_mode` definido, gera preview bullet e propaga no `argsSnapshot`.
- **AC-4:** "sim" executa `pay_bullet_interest_only` (rolagem/quitação) via capability.
- **AC-5:** BOT-006/007 (homônimos) e BOT-001 (léxico) já cobertos no AI-native; manter.
- **AC-6:** Testes de **paridade** rodando o `conversation-orchestrator`/handlers AI-native:
  criação bullet + baixa rolagem/quitação. `npm test` verde; `tsc` 0.

## 4. Implementação

- `src/ai/tools/definitions/mutations.ts`: `+calculation_mode` (create) e `+bullet_mode` (baixa)
  em parameters + inputSchema + dica de descrição.
- `src/ai/tools/handlers.ts`:
  - `createContractHandler`: branch `interest_only` → preview via
    `formatContractConfirmationMessage` + `argsSnapshot.calculation_mode`.
  - `markInstallmentPaidHandler`: detectar bullet (`getInstallmentBulletInfo`); sem
    `bullet_mode` → prompt juros/quitar; com `bullet_mode` → preview bullet +
    `argsSnapshot{ installment_id, contract_id, installment_number, bullet_mode }`.

## 5. QA Gate (@qa — 2026-05-30)

- [x] AC-1..AC-5: tools `create_contract`/`mark_installment_paid` aceitam `calculation_mode`/`bullet_mode`; handlers geram preview bullet e propagam no `argsSnapshot`; execução confirmada reusa o capability executor (BOT-005).
- [x] AC-6 (paridade determinística): `tests/ai-native-handlers.test.ts` +4 casos (create bullet preview+argsSnapshot; baixa pergunta juros/quitar com juros correto R$ 500 — não amount_total; bullet_mode=interest → rolagem; bullet_mode=settle → quitação). `npm test` **370 passed / 4 skipped**; `tsc` 0.
- [x] **Live prod-like pelo caminho AI-native real** (`AI_NATIVE_ENABLED=true` + tenant `ai_enabled=true`, `scripts/live-bullet-cycle.ts`): trace `ai_native_turn source:llm tool_calls:1` → **Gemini chamou a tool com `calculation_mode`**; criação bullet (`interest_only`, installment 500, remaining 5000), rolagem e quitação (`Contrato quitado`) todas executadas.
- ⚠️ Nota histórica de harness (não era bug de produto): o script enviava um turno "1" desenhado para o caminho capability (lista → seleção); no AI-native "baixar contrato" já pode ir direto à escolha juros/quitar, então o "1" extra tornava o live flaky. Resolvido no follow-up path-aware abaixo.
- **Verdict:** ✅ **PASS** — bullet agora disponível nos 4 tenants AI-native. Pronto para `@devops *push`.

## 6. Follow-up de validação (@orchestrator + Claude Code — 2026-05-30)

- [x] `scripts/live-bullet-cycle.ts` tornado **path-aware**: só envia `"1"` quando o primeiro turno de `baixar contrato #id` não trouxe a escolha bullet (`juros simples`/`rolagem`/`quitar`), preservando o legado e removendo o turno extra/flaky no AI-native.
- [x] Paridade de frequência no schema AI-native: `create_contract.frequency` agora aceita `daily` (além de mensal/semanal/quinzenal), mantendo `frequency` e `start_date` no `argsSnapshot` para bullet diário.
- [x] Claude Code (modelo `claude-sonnet-4-6`) revisou o ajuste e executou o live real com Supabase/Gemini: `set -a; . ./.env; set +a; AI_NATIVE_ENABLED=true npx tsx scripts/live-bullet-cycle.ts` → **12/12 checks passados**; criação `interest_only`, rolagem (`remaining=5000`, `status=active`) e quitação (`remaining=0`, `status=completed`) validadas; `path=direct` nas duas baixas.
- [x] Gates locais: `npm run lint` ✅; `npm run typecheck` ✅; `npm test` ✅ (**371 passed / 4 skipped** após teste de `daily` no schema AI-native); `npm run build` ✅.

## 7. Follow-up adversarial de produção (@orchestrator — 2026-05-31)

Achados da conversa/teste adversarial foram tratados sem schema/deploy:

- [x] Criação de contrato continua suportando **multi-turn** (usuários normalmente informam dados em várias mensagens): smoke `conversation-smoke.test.ts` cobre iniciar contrato → informar nome/valor/taxa/parcelas → informar CPF → informar dia → confirmar; probes `probe-create-*clarify*` continuam verdes.
- [x] Parser determinístico hardening: valor por extenso (`cinco mil`), limpeza de marcador `CPF` no nome e `todo dia 10` como vencimento mensal (não frequência diária).
- [x] Baixa aceita linguagem natural/gírias de produção (`recebi`, `pagou`, `caiu o pix`, `mata/matou`, ordinal “segunda prestação”) sem chamar LLM quando há `contract_id`.
- [x] Consulta read-only por contrato (`parcelas em aberto/status do contrato #123`) lista parcelas sem abrir fluxo de baixa/confirmação — evita tratar toda menção a contrato como mutação.
- [x] Claude Code foi acionado para ver Supabase/prod **read-only**; MCP Supabase não recebeu grant em 4 tentativas, então não leu dados. Ele deixou queries `SELECT` seguras preparadas para confirmar `bot_tenant_config`, `ai_enabled`, RPCs bullet e homônimos quando o grant for liberado.
- [x] Gates locais pós-recuperação: `npm run lint` ✅; `npm run typecheck` ✅; `npm test` ✅ (**377 passed / 4 skipped**); `npm run build` ✅.

## 8. File List (realizado)

- `e-finance-bot/src/ai/tools/definitions/mutations.ts` — schema/descrição das tools AI-native com `calculation_mode`, `bullet_mode`, `frequency='daily'` e léxico de baixa de produção.
- `e-finance-bot/src/ai/tools/definitions/queries.ts` — `list_receivables` aceita `contract_id` para consulta read-only de parcelas abertas/status do contrato.
- `e-finance-bot/src/ai/tools/handlers.ts` — preview bullet, prompt juros/quitar, `argsSnapshot` para execução confirmada via capability e resposta read-only por `contract_id`.
- `e-finance-bot/src/ai/intent-router.ts` — roteamento determinístico de gírias de baixa/ordinais e consultas read-only por `contract_id`.
- `e-finance-bot/src/actions/admin-actions.ts` — parser determinístico com valor por extenso e limpeza do marcador `CPF` no nome.
- `e-finance-bot/src/handlers/message-handler.ts` / `e-finance-bot/src/assistant/executors/create-contract.ts` — `todo dia 10` tratado como vencimento mensal; consulta de parcelas por contrato sem iniciar baixa.
- `e-finance-bot/src/assistant/executors/mark-installment-paid.ts` — léxico ampliado de rolagem/quitação bullet (`zerar`, `encerrar`, `matar`, etc.).
- `e-finance-bot/tests/ai-native-handlers.test.ts` — paridade determinística do caminho AI-native (criação bullet, bullet diário no schema, rolagem, quitação e `list_receivables` por contrato).
- `e-finance-bot/tests/admin-actions.test.ts` — regressões de valor por extenso, `todo dia 10` mensal e nome sem contaminação por `CPF`.
- `e-finance-bot/tests/intent-router.test.ts` — regressões para gírias/ordinais de baixa e consultas read-only por contrato.
- `e-finance-bot/scripts/live-bullet-cycle.ts` — harness live path-aware para AI-native vs legado e cleanup auditável.
- `docs/stories/BOT-008-bullet-no-caminho-ai-native.story.md` — evidência de validação final.
- `e-finance-bot/src/ai/response-generator.ts` — limpeza lint NBSP.
- `e-finance-bot/src/ai/tools/handlers.ts` — limpeza lint de imports/const não usados (além da implementação acima).
- `e-finance-bot/src/assistant/executors/mark-installment-paid.ts` — limpeza lint de inicialização inútil.
- `e-finance-bot/tests/evals/probe-create.ts` — limpeza lint de constante não usada.
- `e-finance-bot/tests/probe-baixa.test.ts` — limpeza lint de import não usado.
- `e-finance-bot/tests/probe-create.test.ts` — limpeza lint de import não usado.
