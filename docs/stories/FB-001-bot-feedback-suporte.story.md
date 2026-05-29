# FB-001 — [FEATURE INTERNA] Feedback/reclamação do cliente → encaminhar p/ suporte + registrar

**Agente:** @dev (impl) / @qa (gate) / @devops (deploy) · schema → @data-engineer (gate)
**Status:** Ready for Review
**Criada em:** 2026-05-29
**Origem:** Pedido do usuário — "cliente fala que tem algo errado, o bot encaminha a mensagem pro 85991318582 e anota no banco"
**Epic:** EPIC-BOT — Operação e suporte do assistente
**Prioridade:** Média-Alta — canal de suporte hoje inexistente; reclamações se perdem na conversa
**Bundle de deploy:** branch `feat/bot-billing-announcements-feedback` (vai junto com billing/anúncios, deploy único na sa-east-1)

---

## 1. Contexto e decisões de produto

Feature **INTERNA** do bot. 🔒 **NÃO** publicar em `announcements` (novidades do bot) — é ferramenta operacional, não novidade pro cliente.

Decisões já tomadas com o usuário:
- **Detecção de reclamação: HÍBRIDA** — palavra-chave primeiro (rápido, sem custo); se não bater mas a mensagem cair em `desconhecido`/baixa confiança, IA (Gemini) decide se é reclamação.
- **Auditoria de mensagens: REUSAR o que já existe.** `saveMessage` já persiste **todas** as mensagens (inbound `user` + outbound `assistant`) em `bot_messages` (`session-manager.ts:410`, chamado em `message-handler.ts:982`), e há `bot_turn_traces`. **NÃO** criar tabela/camada nova de auditoria.
- **Destino do encaminhamento:** número de suporte **85991318582**, via o WhatsApp do próprio bot (instância conectada `558520284195`).
- **Confirmação ao cliente:** após registrar, o bot responde algo como *"Anotado! Encaminhei pra nossa equipe, logo alguém te retorna. 🙏"*.

## 2. Escopo

### Incluído
1. **Detecção híbrida** de reclamação/problema:
   - Regra de palavra-chave em `intent-router.ts` → novo intent `reportar_problema` (gatilhos: "problema", "não funciona", "nao funciona", "erro", "bug", "deu errado", "reclamação", "reclamar", "/suporte", "tá com problema", "parou de funcionar").
   - Fallback IA: no ponto de `desconhecido`/baixa confiança (`message-handler.ts:854`), classificação leve decide se a mensagem é reclamação (reusar Gemini do `intent-classifier`, prompt curto, baixo token). Se sim → trata como `reportar_problema`.
2. **Capability `report_feedback`** (kind `mutation`/utility, `rolesAllowed: ['admin','investor','debtor']`) no `capability-registry`, roteada pelo `action-planner` a partir do intent `reportar_problema`.
3. **Encaminhamento + registro** (`src/actions/feedback-actions.ts`):
   - Monta mensagem para o suporte com **texto original + identificação** (nome, telefone/`channel_user_id`, tenant/empresa, canal, timestamp).
   - Envia via WhatsApp (`channels/whatsapp.sendText`) para **85991318582**.
   - Persiste em nova tabela **`bot_feedback`** (registro do feedback, status de encaminhamento).
4. **Confirmação ao cliente** (resposta natural PT-BR, sem menu).
5. **Correção acoplada (bugfix, mesmo deploy):** em `src/scheduler/announcements.ts`, inverter a ordem para **enviar → marcar** (`recordDelivery` hoje ocorre ANTES do `dispatch`; com falha de envio o anúncio se perde). Manter idempotência: se `recordDelivery` falhar por corrida (unique), não reenviar.

### Fora de escopo (NÃO fazer)
- Tabela/camada nova de auditoria de mensagens (já coberto por `bot_messages`).
- Painel web de feedback / dashboard (futuro).
- Resposta/atendimento automatizado da reclamação (só encaminha + confirma).
- Classificação rica de sentimento/categoria (só "é reclamação?" sim/não no fallback).
- Qualquer publicação em `announcements`.

## 3. Critérios de aceite (AC)

- **AC1** — Mensagem com palavra-chave de problema (ex: "o app não funciona") é detectada como `reportar_problema` sem chamar IA.
- **AC2** — Mensagem `desconhecida`/baixa confiança que seja reclamação ("isso aqui tá uma bagunça, ninguém resolve") é detectada via fallback IA; mensagem fora-de-escopo neutra NÃO dispara feedback (sem falso-positivo no caminho feliz).
- **AC3** — Ao detectar, o bot envia ao **85991318582** uma mensagem contendo: texto original do cliente, nome, telefone, tenant/empresa e horário.
- **AC4** — O feedback é persistido em `bot_feedback` com status de encaminhamento (`forwarded_ok` true/false). Se o envio ao suporte falhar, o registro **persiste mesmo assim** (com `forwarded_ok=false`) e há log de erro.
- **AC5** — O cliente recebe confirmação ("anotado, equipe vai retornar"). A confirmação **não** depende do sucesso do envio ao suporte (o registro já garante rastreio).
- **AC6** — Funciona para os 3 papéis (admin/investor/debtor) e nos 2 canais (WhatsApp/Telegram).
- **AC7** — Nenhuma entrada é criada em `announcements` por conta desta feature.
- **AC8 (bugfix)** — `announcements.ts` envia ANTES de marcar a entrega; em falha de envio o anúncio NÃO é marcado como entregue (será reenviado no próximo run). Cobertura de teste do novo comportamento.
- **AC9** — Auditoria das mensagens (inbound/outbound) continua via `bot_messages` sem regressão (a mensagem de reclamação e a confirmação são persistidas como hoje).

## 4. Mudanças de schema (GATE @data-engineer — não aplicar sem aprovação)

Tabela `bot_feedback`:
- `id uuid pk default gen_random_uuid()`
- `tenant_id uuid` (FK tenants, nullable se não vinculado)
- `profile_id uuid` (FK profiles, nullable — cliente pode não estar vinculado)
- `channel text` ('whatsapp'|'telegram'), `channel_user_id text`
- `sender_name text`, `sender_phone text`
- `message_text text not null`
- `forwarded_to text` (ex: '85991318582'), `forwarded_ok boolean not null default false`
- `status text not null default 'open'` (open|handled — uso futuro)
- `created_at timestamptz not null default now()`
- RLS habilitada; acesso só por service-role (bot). Coerente com `bot_*`.

Migration + rollback em `context/`, inspeção do schema real antes, validação depois.

## 5. Tasks (@dev)

1. [x] Schema: migration `bot_feedback` (+ rollback) → @data-engineer aplicou em prod (sa-east-1).
2. [x] `feedback-actions.ts`: `recordAndForwardFeedback(input)` — monta msg de suporte, envia p/ suporte, insere em `bot_feedback` (persiste mesmo se envio falhar; log de erro).
3. [x] `intent-classifier.ts`: novo intent `reportar_problema` (type + INTENT_SET + exemplos nos 2 prompts) + helper `detectComplaintFallback`.
4. [x] `intent-router.ts`: regra de palavra-chave → `reportar_problema`.
5. [x] Fallback IA híbrido em `message-handler.ts`: quando `desconhecido`, `detectComplaintFallback` decide e re-planeja como `reportar_problema` (zero custo no caminho feliz).
6. [x] `capability-registry.ts` + `contracts.ts`: capability `report_feedback` (admin/investor/debtor).
7. [x] `action-planner.ts`: `case 'reportar_problema'` → `report_feedback`.
8. [x] `tool-executor.ts`: executa `report_feedback` (chama feedback-actions, confirma ao cliente; confirmação independe do envio).
9. [x] Env `SUPPORT_FORWARD_PHONE` em `config.ts` (sem hardcode).
10. [x] **Bugfix anúncios:** `announcements.ts` invertido p/ enviar→marcar + testes atualizados.
11. [x] Testes (vitest): keyword (intent-router), insert+forward com forward falhando (persiste), sem phone, insert falho, e novo comportamento dos anúncios.

## Dev Agent Record

**Agent Model Used:** claude-opus-4-8

**Completion Notes:**
- Auditoria de todas as mensagens REUSA `bot_messages` (já persistido via `saveMessage` no `message-handler`), conforme decisão de produto — nenhuma tabela/camada nova de auditoria.
- Fallback IA só dispara quando `intent === 'desconhecido'` → sem custo/latência no caminho feliz (AC2).
- `recordAndForwardFeedback` envia ao suporte primeiro (best-effort) e SEMPRE persiste o registro (forwarded_ok reflete o resultado) → nenhuma reclamação se perde (AC4).
- Bugfix anúncios (AC8): enviar→marcar. Falha de envio não marca entrega (reenviável); corrida (unique) conta como já entregue.
- Feature INTERNA: nada gravado em `announcements` (AC7).
- `npm run build` limpo; suíte 245 passando | 4 skipped (eram 239).

**File List:**
- `src/config.ts` (M) — env `support.forwardPhone`
- `src/actions/feedback-actions.ts` (A) — registrar + encaminhar
- `src/ai/intent-classifier.ts` (M) — intent `reportar_problema` + `detectComplaintFallback`
- `src/ai/intent-router.ts` (M) — regra de palavra-chave
- `src/handlers/message-handler.ts` (M) — fallback híbrido
- `src/assistant/contracts.ts` (M) — capability `report_feedback`
- `src/assistant/capability-registry.ts` (M) — registro da capability
- `src/assistant/action-planner.ts` (M) — case `reportar_problema`
- `src/assistant/tool-executor.ts` (M) — handler `report_feedback`
- `src/scheduler/announcements.ts` (M) — bugfix enviar→marcar
- `context/migration_bot_feedback.sql`, `context/rollback_bot_feedback.sql` (A) — @data-engineer
- `tests/feedback-actions.test.ts` (A), `tests/intent-router.test.ts` (M), `tests/announcements.test.ts` (M), `tests/message-handler.test.ts` (M), `tests/evals/harness.ts` (M)

**Change Log:**
- 2026-05-29 — FB-001 implementada (feedback/suporte + fix anúncios). Status → Ready for Review.
- 2026-05-29 — QA-fix (gate FAIL→loop): fallback híbrido define `confidence: 'high'` ao re-planejar `reportar_problema` (`message-handler.ts`), evitando short-circuit por baixa confiança; +teste de regressão (`message-handler.test.ts`) cobrindo fallback→executor; env `SUPPORT_FORWARD_PHONE` documentada no doc de ativação. Build limpo; 246 testes passando (+1). LOW do gate (confirmação mesmo com insert falho) mantido — aceitável/logado.

## 6. Dependências e sequência

- Schema (`bot_feedback`) deve existir antes do `feedback-actions` rodar em prod → **gate @data-engineer primeiro**.
- Vai no **mesmo bundle**/branch do billing/anúncios; @devops faz **deploy único** na sa-east-1 + envs (incluir `SUPPORT_FORWARD_PHONE`).
- UazAPI já reconectado (`558520284195`) → envio ao suporte funciona.

## 7. Notas de teste / verificação

- Unit (vitest) conforme task 11.
- Local: simular inbound de reclamação e verificar (a) insert em `bot_feedback`, (b) chamada de envio ao suporte, (c) confirmação ao cliente.
- Prod (skill `prod-smoke-test` + MCP Supabase): após deploy, mandar uma reclamação de teste de um número vinculado, conferir o registro em `bot_feedback` e a chegada no 85991318582.
- Regressão: `npm run build` limpo + suíte verde (hoje 239 testes).

---

## QA Results

**Gate:** ❌ **FAIL** — 1 must-fix antes do deploy · Revisor: @qa (Quinn) · 2026-05-29
**Escopo:** bundle `feat/bot-billing-announcements-feedback` (billing + anúncios + FB-001)

### 🔴 CRITICAL (must-fix) — caminho de IA do híbrido está morto
`src/handlers/message-handler.ts:1946-1950` — quando `detectComplaintFallback` retorna `true`, o intent é sobrescrito para `reportar_problema` mas a **confiança permanece `low`** (herdada do `desconhecido`). Logo em seguida, `getPlanClarificationMessage` (`message-handler.ts:900`) intercepta qualquer plano com `confidenceLabel === 'low'` e devolve *"Ainda não fechei isso com segurança..."*, fazendo **short-circuit antes do policy/executor**. Resultado: na detecção por IA, a reclamação **NÃO é encaminhada nem registrada** e o cliente recebe uma pergunta confusa. Quebra **AC2/AC3/AC4/AC5** no caminho de fallback (o caminho por palavra-chave funciona, pois regra → confiança alta).

**Fix (1 linha):**
```ts
understanding = { ...understanding, intent: 'reportar_problema', confidence: 'high' };
```
**+ teste de regressão:** integração no `message-handler.test.ts` com `detectComplaintFallback→true` cobrindo execução do `report_feedback` (chamada a `recordAndForwardFeedback` + confirmação), evitando reincidência. A suíte atual passou (245) porque nenhum teste exercita o caminho fallback→executor.

### 🟡 CONCERNS
- **Env não documentada (deploy):** `SUPPORT_FORWARD_PHONE` não está no `deploy-bot.sh` nem no doc de ativação. Sem ela, o encaminhamento é pulado (registra com `forwarded_ok=false` — degradação graciosa, ok), mas o suporte não recebe. @devops deve adicionar `SUPPORT_FORWARD_PHONE=5585991318582` ao deploy.

### 🔵 LOW (aceitável)
- `tool-executor` retorna "Anotado!" mesmo se o `insert` em `bot_feedback` falhar (caso raro de duplo-erro envio+insert). Está logado; aceitável.

### ✅ Aprovado na auditoria
- **AC4** (registro persiste mesmo com falha de envio) — `feedback-actions.ts` insere sempre; `forwarded_ok` reflete o resultado. ✔
- **AC7** (feature interna não publica em `announcements`) — caminho de feedback escreve só em `bot_feedback`. ✔
- **AC8** (bugfix anúncios enviar→marcar) — `announcements.ts` corrigido; falha de envio não marca entrega. ✔
- **Auditoria de mensagens** — reusa `bot_messages` (sem reinvenção). ✔
- **Schema** — `bot_feedback` aplicado com gate, RLS service-role, CHECKs, FKs SET NULL. ✔
- **Multi-canal** — funciona WhatsApp/Telegram (sender_phone null no Telegram, usa channel_user_id). ✔
- Build limpo; 245 testes (cobertura do fallback→executor é a lacuna que escondeu o bug crítico).

### Decisão
Voltar para **@dev** (QA loop): aplicar o fix de 1 linha + teste de regressão; depois re-gate. **Não** deployar antes. CodeRabbit não executado neste ambiente (advisory).

---

## QA Results — Re-gate (iteração 2)

**Gate:** ✅ **PASS** · Revisor: @qa (Quinn) · 2026-05-29

Verificação no código real (não no resumo):
- **🔴 CRITICAL resolvido** — `message-handler.ts:1950` agora re-planeja com `{ ...understanding, intent: 'reportar_problema', confidence: 'high' }`. Com confiança alta, `getPlanClarificationMessage` retorna null (não barra), e o plano `report_feedback` (sem checks especiais) segue para policy/executor. ✔
- **🔴 Teste de regressão** — `message-handler.test.ts:309` exercita o caminho `desconhecido` + `detectComplaintFallback→true`: assere `recordAndForwardFeedback` chamado, resposta contém "Anotado" e **não** contém "Ainda não fechei". Cobre exatamente a lacuna que escondeu o bug. ✔
- **🟡 CONCERN resolvido** — `SUPPORT_FORWARD_PHONE=5585991318582` documentada no doc de ativação (com nota de degradação graciosa). ✔
- **🔵 LOW** — mantido (aceitável/logado).

**Evidência:** `npm run build` limpo; testes-chave 56/56 verdes (`message-handler` 24, `intent-router` 22, `announcements` 6, `feedback-actions` 4); suíte total 246 passando | 4 skipped.

**Traceability AC:** AC1 (keyword) ✔ · AC2 (fallback IA sem falso-positivo no caminho feliz — só dispara em `desconhecido`) ✔ · AC3/AC4/AC5 (encaminha/registra/confirma, registro persiste em falha) ✔ · AC6 (multi-canal) ✔ · AC7 (não publica em `announcements`) ✔ · AC8 (anúncios enviar→marcar) ✔ · AC9 (auditoria reusa `bot_messages`) ✔.

### Decisão final
**PASS** — bundle liberado para o **@devops** fazer o deploy único na sa-east-1. Lembrar no deploy: envs de billing + **`SUPPORT_FORWARD_PHONE=5585991318582`** + criar os 2 Cloud Scheduler jobs. Migrations já aplicadas em prod.
