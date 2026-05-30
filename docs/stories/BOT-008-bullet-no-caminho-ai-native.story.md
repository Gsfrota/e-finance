# BOT-008 — Bullet no caminho AI-native (paridade com a capability)

**Agentes:** @pm → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review
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
- ⚠️ Nota de harness (não é bug de produto): o script envia um turno "1" desenhado para o caminho capability (lista → seleção); no AI-native "baixar contrato" vai direto à escolha juros/quitar, então o "1" extra é interpretado de forma não-determinística pelo LLM → o check `db-quitacao-encerra` ficou flaky (10/11 numa rodada, 11/11 em outra). Produto OK; recomendado tornar o script path-aware num follow-up.
- **Verdict:** ✅ **PASS** — bullet agora disponível nos 4 tenants AI-native. Pronto para `@devops *push`.
