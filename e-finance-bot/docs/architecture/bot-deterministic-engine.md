# Blueprint — Trazer o motor determinístico do MasterMenu para o `e-finance-bot`

> **Status:** Blueprint para aprovação (2026-06-14) — somente arquitetura, sem código ainda.
> **Origem:** adapta o padrão "Core Engine + Domain Packs" de
> `../../../MasterMenu/docs/architecture/bot-template-core-domain-packs.md`.
> **Escopo travado com o usuário:** dirigir o **assistente admin atual** (dashboard, criar contrato,
> dar baixa, buscar devedor) como **máquina de estados determinística**, com **NLU determinístico-first
> e Gemini só como fallback de baixa confiança** — igual ao MasterMenu. NÃO é o fluxo de cobrança ao
> devedor (esse continua sendo um pack futuro, fora deste escopo).

## Context

O bot determinístico do MasterMenu é um **Code node de ~7.800 linhas no n8n**: máquina de estados fixa
(`greeting→ordering→qty→cart→identity→address→payment→confirm→done`), NLU por fuzzy/Levenshtein, Gemini
só de fallback, estado em `whatsapp_sessions.state`. O `e-finance-bot` é o oposto estrutural: app
TS/Express com pipeline de ~20 estágios **fortemente dependente de IA** (Gemini no áudio, no router, no
rewrite de resposta e no modo AI-native).

**Não dá pra "copiar e colar":** o engine do MasterMenu é jsCode de n8n e a operação é outra (pedido de
comida vs. crédito). O que se transfere é o **padrão**, e a boa notícia é que **metade dele já existe** no
nosso bot — só está fragmentada:

- O roteamento **já é determinístico-first**: `intent-router.ts` tem ~95 regex → 39 intents, com cache de
  5min e Gemini só no fallback de baixa confiança (timeout 2s). Isso é exatamente o `quickIntent()` do
  MasterMenu. Não precisamos inventar isso — precisamos **consolidar e externalizar**.
- O estado conversacional **já é persistido**: `ConversationWorkingState` v2 em `bot_sessions.context`
  (TTL 30min), com `focusedEntity`, `candidateSets`, `pendingConfirmation`, `pendingCapability`.
- As regras financeiras **já são determinísticas e tenant-scoped**: `admin-actions.ts` chama RPCs do
  Supabase; o LLM nunca decide regra nem autorização.

**O que falta para virar o padrão MasterMenu** (as 3 lacunas reais):

1. **A FSM está partida em dois mundos.** As mutações multi-turno (`create_contract`,
   `mark_installment_paid`) ainda rodam pelo state machine **legado** em `message-handler.ts` via
   `pendingAction`/`pendingStep`/`pendingData` (ver `legacy-state-adapter.ts` e `MIGRATED_CAPABILITIES`).
   A camada nova (`action-planner` → `policy-engine` → `tool-executor`) fica **por cima**. Não há um
   **executor de grafo único** — há dois caminhos coexistindo, com adapter de espelhamento entre eles.
2. **As strings PT-BR estão hardcoded no código** (response-generator, prompts de wizard, mensagens de
   erro), não em config de banco editável sem deploy. No MasterMenu isso já mora em `config.messages.*`.
3. **A IA está em pontos que poderiam ser determinístico-first.** O `response-generator` faz rewrite via
   LLM em **toda** resposta (`replyMode: 'rewrite'`); o modo AI-native existe como caminho alternativo.

> **Invariante-chave a preservar** (igual ao MasterMenu): tenant **sempre** resolvido pelo binding do
> canal/token, nunca de input do cliente; toda escrita via RPC tenant-scoped (RLS). Isso já é verdade no
> `session-manager.ts` + `admin-actions.ts` — a refatoração **não pode** afrouxar isso.

Resultado pretendido: **um executor de grafo único e determinístico-first** para o assistente admin,
dirigido por um **domain pack do e-finance** + **config no banco**, reaproveitando a infra de sessão,
canais, policy e actions que já existem — sem big-bang rewrite e sem regressão de comportamento.

---

## 1. Separação Core vs Domain Pack (mapeada ao código atual)

**Core Engine (genérico, candidato a virar pacote reusável depois):**

| Responsabilidade | Onde vive HOJE | Ação |
|---|---|---|
| Parse/normalização do webhook, dedupe, rate-limit, buffer | `src/index.ts` | mantém (já genérico) |
| Sessão get/upsert, binding de canal, histórico (cap N) | `src/session/session-manager.ts` | mantém |
| NLU determinístico-first (regex + cache) → fallback LLM | `src/ai/intent-router.ts` | **core**; vocab/sinais saem p/ pack |
| Executor da máquina de estados | **NÃO EXISTE como peça única** | **criar** (`src/engine/state-runner.ts`) |
| Policy gate por role/tenant | `src/assistant/policy-engine.ts` | mantém (core) |
| Executor de actions (timeout/retry/log/idempotência) | `src/assistant/tool-executor.ts` (parcial) | generalizar p/ registry |
| Naturalização de resposta (opcional) | `src/ai/response-generator.ts` | **core, mas vira opt-in** |
| Confirmação sensível multi-turno | `src/assistant/confirmation-store.ts` | mantém (core) |
| Canais (envio, presença "digitando") | `src/channels/` | mantém |

**Domain Pack do e-finance admin (todo o conteúdo + grafo + ações):**

| O que | Onde vive HOJE | Para onde vai |
|---|---|---|
| Vocabulário/sinônimos das intents | espalhado em `intent-router.ts` RULES | `packs/efinance-admin/vocab.ts` + `config.nlu.vocab` |
| Grafo de estados das mutações | implícito em `message-handler.ts` (`pendingStep`) | `packs/efinance-admin/states.ts` (declarativo) |
| Matriz de role por capability | `capability-registry.ts` (já declarativo) | vira o pack (24 capabilities) |
| Mapeamento capability → RPC | `admin-actions.ts` chamado por `tool-executor` | `packs/efinance-admin/actions.ts` (registry) |
| Strings PT-BR (prompts, erros, ajuda) | hardcoded em vários arquivos | `config.messages.*` (JSONB no banco) |

**Regra de ouro (mesma do MasterMenu):** muda entre **tenants** do mesmo domínio → `config` JSONB no
banco. Muda o **grafo de estados / ações / vocabulário** → código do domain pack.

## 2. Contrato de Config no Banco

Hoje **não há** tabela de config de bot por tenant com as mensagens (as strings estão no código). Proposta
**aditiva** (gate de banco obrigatório — ver §Verificação):

- `bot_tenant_configs` (tenant_id, `version`, `active`, `config` jsonb) — versionado p/ rollback de config
  sem deploy. *(Confirmar no schema real se já existe algo parecido; o CLAUDE.md cita `bot_tenant_configs`
  como tabela existente — inspecionar antes de propor DDL.)*

SHAPE de `config` (ilustrativo, mesmo espírito do MasterMenu): `schema_version`, `locale`, `currency`,
`messages` (chave→texto PT-BR), `nlu` (`vocab` de sinônimos por intent, `fuzzy_max_distance`,
`llm.enabled`, `llm.provider`), `features` (flags: `llm_router`, `llm_rewrite`, `audio_stt`,
`ai_native`), `rate_limit`. O `t(key)` lê de `config.messages[key]` com fallback p/ default embutido no
pack (nunca quebra se a chave não existe no banco).

**Migração de strings:** Fase 1 move as PT-BR hardcoded para `config.messages.*` com **paridade exata**
(o texto no banco começa idêntico ao hardcoded) — depois fica editável sem deploy.

## 3. Máquina de Estados (adaptada — não é fluxo linear de pedido)

O assistente admin **não** é um funil linear como pedido de comida. É um **dispatcher de comandos** com
**sub-fluxos multi-turno**. Modelar como grafo com um estado-raiz e sub-grafos:

```
idle (dispatch de comando)
 ├── wizard:create_contract   (devedor → cpf → valor → taxa → parcelas → freq → vencimento → confirm)
 ├── wizard:mark_payment      (busca parcela → desambigua → confirm)
 ├── disambiguation:debtor    (homônimos: "o outro" / número / final de CPF)
 ├── confirmation:pending     (mutação sensível aguardando "sim/não")
 └── company_selection        (admin multi-empresa)
```

- **Persistência:** reusar `bot_sessions.context.workingState` (já existe, TTL 30min). Adicionar um campo
  **`fsmState`** explícito (string) que hoje está implícito em `pendingCapability`/`pendingStep`. Mudança
  **aditiva** — o `legacy-state-adapter.ts` já espelha entre os dois mundos; o novo campo passa a ser a
  fonte canônica e o legado vira espelho de leitura durante a transição.
- **Handler puro por estado** (mesma assinatura do MasterMenu): `handle(ctx, intent, config, services)
  → { reply?, nextState?, contextPatch?, actions?[], confirmation? }`. Sem I/O direto: o `state-runner`
  executa as `actions` e renderiza `reply` via `t(key)`.
- **O executor é único e genérico** — substitui os dois caminhos coexistentes (legado em
  `message-handler.ts` + camada nova). É a peça que **falta criar** (`src/engine/state-runner.ts`).
- **Comportamento idêntico ao atual é o gate.** O grafo deve reproduzir exatamente os fluxos de
  `create_contract` e `mark_installment_paid` que hoje rodam por `pendingStep` (ver matriz em
  `docs/contract-creation-matrix.md`).

## 4. Domain Actions (já existe a base — falta uniformizar)

O core não chama RPC de domínio direto; o pack declara um **registry de actions** e o `state-runner`
executa com timeout/retry/log/idempotência. Hoje isso está **parcialmente** em `tool-executor.ts`
(executa algumas direto, delega outras a `dispatchIntent` legado). Proposta:

- `DomainAction`: `kind` (`supabase_rpc`), `fn`, `idempotencyKey` (campo do context), `timeoutMs`,
  `mapResult`. Idempotência igual ao `cart_hash` do MasterMenu — aqui: `last_confirmed_*` por mutação.
- Pack e-finance registra o que já existe em `admin-actions.ts`: `getDashboardSummary`, `getInstallments`,
  `getDebtorsToCollectToday`, `createContract`, `markInstallmentPaid`, `searchUser`, `generateInvite`, etc.
- Segurança preservada: tudo via RPC tenant-scoped / `service_role` server-side (nunca expõe ao cliente);
  placeholders `{tenant_id}`, `{context.*}` resolvidos pelo core. **Não afrouxar** o invariante de tenant.

## 5. Postura de IA — determinístico-first com fallback (decisão travada)

| Uso de IA hoje | Decisão |
|---|---|
| `intent-router` LLM fallback (baixa confiança) | **Mantém** — é exatamente o padrão desejado. |
| `response-generator` rewrite em TODA resposta | **Vira opt-in** (`features.llm_rewrite`). Default das respostas estruturadas passa a ser `replyMode: 'raw'` com templates `t(key)`; rewrite só onde agrega. |
| Modo AI-native (function calling LLM-first) | **Fica atrás de flag** (`features.ai_native`, já é default off) — não é o caminho principal da FSM. |
| Transcrição de áudio (Gemini STT) | **Mantém** sob flag `features.audio_stt` — não há alternativa determinística para áudio. |

Interface de NLU plugável (igual MasterMenu §6g): determinístico continua como caminho barato; LLM só em
baixa confiança, atrás de `config.nlu.llm.provider` (gemini hoje, claude possível).

## 6. Roadmap Faseado (sem big-bang, paridade como gate em cada fase)

- **Fase 0 — Harness de paridade (sem mudar comportamento):** congelar o comportamento atual em testes.
  Suíte vitest sobre `intent-router`/wizards + um conjunto de conversas-ouro (golden transcripts) por
  fluxo. *Valida:* baseline verde que todas as fases seguintes têm que manter idêntico.
- **Fase 1 — Externalizar strings p/ `bot_tenant_config.messages`** *(em andamento)*: `t(key)` +
  `src/i18n/messages.ts` ✅; coluna `messages jsonb` aplicada e validada (migration
  `20260614200718_bot_messages_i18n`, CHECK chave→texto) ✅; fast-path migrado com paridade exata + wiring
  do override via `loadTenantAiConfig` ✅. **Falta:** migrar os demais lotes (response-generator, prompts
  de wizard, erros). *Valida:* editar `messages` no banco muda o bot sem deploy; `test:parity` 209/209.
- **Fase 2 — Extrair o `state-runner` + pack declarativo:** criar `src/engine/state-runner.ts` e
  `packs/efinance-admin/{states,vocab,actions}.ts`. Migrar **`create_contract`** primeiro (mais complexo,
  multi-turno) do `pendingStep` legado p/ handler puro; `fsmState` vira canônico, legado vira espelho.
  *Valida:* break-path matrix de criar-contrato verde; zero regressão vs Fase 0.
- **Fase 3 — Migrar `mark_installment_paid` + desambiguação + company_selection** p/ o grafo; remover o
  caminho legado de `message-handler.ts` quando o último fluxo sair. *Valida:* `MIGRATED_CAPABILITIES`
  cobre tudo; `legacy-state-adapter` pode ser aposentado.
- **Fase 4 — Postura de IA:** `llm_rewrite` opt-in; respostas estruturadas em `raw` por default; flags em
  `config.features`. *Valida:* latência/custo caem; respostas seguem naturais nos fluxos onde rewrite fica.
- **Fase 5 — Observabilidade + rollback:** tabela `bot_events` (state_from/to, intent, action, nlu_source,
  latency, outcome) p/ medir drop-off por estado e hit-rate do determinístico; `config.version/active` p/
  rollback sem deploy. *Valida:* dashboard por tenant; rollback testado.

## Arquivos críticos (referência no repo atual)

- `src/handlers/message-handler.ts` — pipeline + state machine legado (`pendingStep`) a extrair (Fases 2-3).
- `src/assistant/legacy-state-adapter.ts` — ponte entre legado e `workingState`; aposentar na Fase 3.
- `src/ai/intent-router.ts` — NLU determinístico-first já existente; vocab sai p/ pack (Fase 2).
- `src/ai/response-generator.ts` — rewrite LLM a tornar opt-in (Fase 4).
- `src/assistant/capability-registry.ts` — matriz de roles já declarativa; vira o pack.
- `src/assistant/tool-executor.ts` — base do registry de actions a uniformizar (Fase 2).
- `src/actions/admin-actions.ts` — regras financeiras (RPCs); permanecem como domain actions.
- `docs/operational-assistant-architecture.md` + `docs/contract-creation-matrix.md` — contrato atual a preservar.

## Verificação (quando implementar)

- Toda fase passa pelo **gate de paridade da Fase 0** (`npm run test:parity` — 199 testes offline, ver
  `parity-baseline.md`) antes do merge: tem que continuar verde sem encolher.
- Qualquer mudança de schema (`bot_tenant_configs`, `fsmState`, `bot_events`) passa pelo **gate de banco**
  (inspecionar schema real → multi-tenant → aprovação explícita do usuário → validar pós-migração),
  conforme CLAUDE.md ("Claude é o guardião do banco").
- Invariante de segurança auditado a cada fase: tenant via binding/token, escrita via RPC tenant-scoped,
  nunca afrouxar RLS.

## Notas de processo

Artefato de **arquitetura/blueprint**, não story de código. Para evoluir p/ implementação: spec-driven
obrigatório — abrir epic (@pm) → stories (@sm) por fase, com gate de banco nas mudanças de schema. Nada
aqui altera o bot em produção.
