# E-Finance Bot — Análise de Arquitetura

**Autor:** Aria (Architect) — análise baseada em leitura do código  
**Data:** 2026-04-29  
**Escopo:** Identificar gaps que comprometem (a) **comunicação fluida com o usuário** e (b) **confiabilidade na execução de ações**.  
**Audiência:** Codex revisará — seções estão escritas para serem auditáveis com `file:line`.

---

## 1. ARQUITETURA REAL

O bot tem **dois caminhos paralelos** que convivem hoje, controlados por gate canário:

```
                       Webhook (UazAPI / Telegram)
                                  │
                          src/index.ts (Express)
                                  │
                    Dedup → Rate-limit → Inbound buffer (3.5s/12s)
                                  │
                  src/handlers/message-handler.ts (3.487 linhas)
                                  │
                    Session: getOrCreateSession + sync
                                  │
                       Audio? → audio-pipeline (Gemini STT)
                       Image? → analyzeImage
                                  │
                    Prompt-guard (6 patterns + base64)
                                  │
              ┌──────────── shouldTryAiNative(tenantId)? ───────────┐
              │                                                     │
              SIM (canário)                                       NÃO
              │                                                     │
   ┌──────────▼──────────────────┐                  ┌──────────────▼──────────────┐
   │ AI-NATIVE                   │                  │ LEGACY (pipeline antigo)    │
   │ src/ai/conversation-        │                  │                             │
   │   orchestrator.ts (409 ln)  │                  │ pendingConfirmation? sim →  │
   │                             │                  │   policy → executor         │
   │ 1. fast-path? (zero LLM)    │                  │                             │
   │ 2. ai_enabled tenant?       │                  │ legacyPending (wizard)?     │
   │ 3. budget guard (BR-008)    │                  │   handlePendingAction       │
   │ 4. buildSystemPrompt        │                  │                             │
   │    + history (8 últ.) +     │                  │ company selection?          │
   │    tools por role           │                  │   resolveCompanySelection   │
   │ 5. Gemini Flash/Pro com     │                  │                             │
   │    function calling         │                  │ followup-resolver →         │
   │ 6. loop max 3 iterações     │                  │   intent-router (80 regex   │
   │    (timeout 20s)            │                  │   + Gemini Flash-Lite       │
   │                             │                  │   fallback) →               │
   │ Falha → fallthrough ──┐     │                  │   intent-classifier →       │
   └───────────────────────┼─────┘                  │   action-planner →          │
                           │                        │   policy-engine →           │
                           └────────────────────────►   tool-executor (969 ln) →  │
                                                    │   executors/* (1.045 ln)    │
                                                    │   admin-actions.ts          │
                                                    │     (2.346 ln)              │
                                                    └─────────────────────────────┘
                                                                │
                                                                ▼
                                                  response-generator (Gemini Flash-Lite)
                                                                │
                                                            send + persist async
```

### Estado real das tools no AI-native (`src/ai/tools/handlers.ts`)

| Tool                       | Status                                  |
| -------------------------- | --------------------------------------- |
| `show_dashboard`           | ✅ wired                                |
| `list_receivables`         | ✅ wired                                |
| `list_collection_targets`  | ✅ wired                                |
| `query_debtor_balance`     | ✅ wired                                |
| `query_receivables_window` | ✅ wired                                |
| `query_collection_window`  | ✅ wired (alias do anterior)            |
| `generate_report`          | ✅ wired                                |
| `view_my_installments`     | ✅ wired                                |
| `view_my_debt_summary`     | ✅ wired                                |
| `view_my_portfolio`        | ✅ wired                                |
| `generate_invite`          | ✅ wired                                |
| **`create_contract`**      | ❌ **`notWired` stub** (handlers.ts:273)|
| **`mark_installment_paid`**| ❌ **`notWired` stub** (handlers.ts:274)|
| **`disconnect_bot`**       | ❌ **`notWired` stub** (handlers.ts:275)|
| **`configure_briefing`**   | ❌ **`notWired` stub** (handlers.ts:276)|
| **`preview_lembrete`**     | ❌ **`notWired` stub** (handlers.ts:277)|

Comentário no próprio código: `// Mutações permanecem stubs (notWired) até AI-S6` (handlers.ts:9-10).

---

## 2. PONTOS FORTES (não tocar)

Para o Codex: estes itens estão bem desenhados — não considerar como gaps.

| # | Item | Evidência |
|---|------|----------|
| F1 | Inbound buffer **serializa** flushes por chave (chain de promises) | `inbound-buffer.ts:111-126` (`runSerialized`) |
| F2 | Confirmação tem **idempotency key** (sha1 dos args) + TTL | `confirmation-store.ts:7-17, 36-50` |
| F3 | Working state tem TTL configurável + auto-expiração de `pendingConfirmation` | `working-state-store.ts:13-48` |
| F4 | Session `getOrCreateSession` trata corrida via `code 23505` (unique violation) | `session-manager.ts:238-259` |
| F5 | Mensagens persistidas em fila ordenada por `sessionId` (não fire-and-forget) | `session-manager.ts:69, 190-202` |
| F6 | Fast-path resolve 30-40% das mensagens com zero LLM e zero budget | `fast-path.ts` |
| F7 | Prompt-guard cobre 6 vetores + base64 + SQL | `prompt-guard.ts:15-40` |
| F8 | Tool registry filtra por role no momento da declaração ao Gemini | `tools/registry.ts:29-33`, `conversation-orchestrator.ts:155, 309-313` |
| F9 | Args validados via Zod **antes** de chamar handler (defesa contra LLM alucinar) | `conversation-orchestrator.ts:315-322` |
| F10 | Telemetria estruturada com latency breakdown por estágio | `message-handler.ts:1982-1999` |
| F11 | Tenant config cacheado em memória (60s TTL) — evita N round-trips | `system-prompt-builder.ts:37-69` |
| F12 | System prompt tem regras inegociáveis em PT-BR (não inventar, mutações exigem confirmação, role respect) | `system-prompt-builder.ts:168-175` |
| F13 | Audio pipeline tem timeout adaptativo por duração + tamanho + fallback Files API | `audio-pipeline.ts:94-101` |
| F14 | Migração rebind: quando `channel_user_id` muda de profile, contexto e histórico são limpos | `session-manager.ts:275-348` |

---

## 3. GAPS DE COMUNICAÇÃO COM O USUÁRIO

> "O usuário precisa se comunicar perfeitamente."

### G1. Mutações no AI-native viram loop até falhar [CRÍTICO]

**Sintoma percebido pelo usuário:** No tenant canário, ao pedir "criar contrato" ou "marcar pago", recebe mensagem genérica `"Consegui algumas informações, mas preciso que você seja mais específico..."` (orchestrator.ts:282) após 20s de espera.

**Causa raiz:** LLM tenta `create_contract` → handler retorna `{kind: 'error', message: 'Tool create_contract ainda não foi conectada ao handler — AI-S6 pendente.'}`. O LLM, ao receber `status: 'error'`, frequentemente tenta argumentos diferentes ou outra tool, consumindo as 3 iterações até estourar.

**Locais:**
- `src/ai/tools/handlers.ts:5-9` (helper `notWired`)
- `src/ai/tools/handlers.ts:273-277` (5 mutations stubadas)
- `src/ai/conversation-orchestrator.ts:223` (`MAX_TOOL_ITERATIONS = 3`)
- `src/ai/conversation-orchestrator.ts:281-287` (mensagem genérica ao estourar)

**Impacto:** Para os tenants canário, *todas* as ações de mutação travam. Custo: usuário pensa que o bot é lento e quebrado, paga budget de 3 chamadas Gemini por tentativa.

---

### G2. AI-native não consegue concluir wizards multi-turn [CRÍTICO]

Mesmo se as mutações fossem wired, o AI-native **não tem mecanismo de pendência**. O LLM recebe history dos últimos 8 turnos (orchestrator.ts:63 + 157), mas:

- Não consulta `workingStateV2.contractDraft` (legacy do pipeline antigo)
- Não pode setar `pendingConfirmation` dele mesmo (não recebe `Session` mutável ali)
- Se pede "criar contrato", LLM tem que coletar 7 campos numa única conversa de até 3 iterações de tool

**Local:** `src/ai/conversation-orchestrator.ts:38-44` (input não inclui working state) — o `ToolContext` recebe sessão mas o LLM não enxerga o draft.

**Impacto:** Mesmo após "AI-S6", contratos por voz/texto natural longo não vão funcionar bem porque o LLM não consegue persistir progresso entre turnos.

---

### G3. response-generator pode parafrasear errado e mudar fatos [ALTO]

O legacy gera resposta determinística (ex.: tabela de recebíveis), depois passa por `renderConversationalReply` (response-generator.ts:95) que pede ao LLM uma frase de abertura. O *prompt* tenta proteger (`Sem repetir fatos, valores ou datas`, response-generator.ts:121), mas:

- A heurística `looksStructuredReply` (response-generator.ts:52-60) decide se vai modo "rewrite" ou "prefix". Se classificar errado, o LLM **reescreve a resposta inteira** em "rewrite mode" (linha 144-159) — `Maximo 2 frases` mas o LLM pode omitir parcelas.
- Sem teste automático que prove que o output preserva os mesmos valores em R$/CPF/data.

**Local:** `src/ai/response-generator.ts:52-60, 95-169`

**Impacto:** Risco de o usuário ver `"Você tem 5 parcelas para receber esta semana"` quando havia 8. Quem audita?

---

### G4. Working state v1/v2 dual schema causa drift silencioso [MÉDIO]

Existem **três** locais de estado:
- `session.context.pendingAction/pendingStep/pendingData` (legacy v1)
- `session.context.workingState` (v2 estruturado)
- `session.context.workingStateV2` (mais novo ainda)

A ponte é `legacy-state-adapter.ts` (140 linhas). Comportamento real:

- `message-handler.ts:1468`: `legacyPendingAction = session.context.workingStateV2?.legacyPending?.action || session.context.pendingAction`
- `message-handler.ts:1469`: prioriza `pendingConfirmation` mas **só se** `!legacyPendingAction` — comportamento entrelaçado.

**Impacto:** Se um caminho atualiza só v1 e outro só v2, bot pode pedir confirmação que nunca chega ou ignorar wizard ativo. Não há teste de invariante "v1 ↔ v2 consistentes".

**Local:** `src/handlers/message-handler.ts:1467-1601`, `src/assistant/legacy-state-adapter.ts`

---

### G5. Prepend de áudio só dispara para 4 padrões fixos [MÉDIO]

`shouldPrependAudioPreview` só inclui `"Entendi do áudio: '...'"` se a resposta começa com um dos 4 padrões hard-coded (message-handler.ts:91-96).

Para qualquer outra resposta (dashboard, lista de recebíveis, erro, etc.) o usuário **não vê** o que foi transcrito. Em ambiente ruidoso, isso esconde erros de transcrição até o ponto onde o bot já tomou ação.

**Local:** `src/handlers/message-handler.ts:91-101`

**Impacto:** Usuário fala "marca a parcela do João" → bot transcreve "marca a parcela do Júlio" → executa em Júlio sem nunca mostrar a transcrição. *Apenas mutações com confirmação mostram o áudio* — queries não.

---

### G6. Fallback de erro não diferencia tipos [MÉDIO]

Em `message-handler.ts:1965-1972` o catch único produz três variações genéricas baseadas em `error.message === 'session_get_timeout'` etc. Demais erros viram `"❌ Ocorreu um erro ao processar sua mensagem. Tente novamente em instantes."`.

Não há classificação para:
- Quota Gemini estourou
- Tool retornou `retryable: true`
- RLS Supabase rejeitou (tenant errado)
- Network timeout vs quota vs validation

**Impacto:** Usuário não sabe se deve tentar de novo, esperar, ou contatar admin.

---

### G7. Greeting separado consome budget extra [BAIXO]

`generateGreeting` (response-generator.ts:171-196) faz uma chamada Gemini independente para responder "oi". Mas `fast-path.ts:78-82` já tem resposta determinística para saudação.

Hoje fast-path roda primeiro (orchestrator.ts:112-130), então `generateGreeting` provavelmente nunca dispara no AI-native. Mas no caminho legacy ela está pendurada e pode dispara duas vezes em raras condições.

**Local:** dead code de risco — `src/ai/response-generator.ts:171-196`

---

## 4. GAPS DE EXECUÇÃO CONFIÁVEL DE AÇÕES

> "...e executar ações com confiabilidade."

### E1. Tools paralelos no AI-native podem corromper estado [CRÍTICO]

`conversation-orchestrator.ts:252-258` executa todas as function calls da mesma resposta com `Promise.all`. Se o LLM emitir `create_contract({...})` + `mark_installment_paid({...})` no mesmo turn:

- Não há transação cross-tool
- Se uma falha após a outra commit-ar, fica inconsistência
- O `workingState` é leitura no início, escrita no fim — duas tools que mutam estado fazem race local

Hoje o risco é teórico porque mutações estão `notWired`. Mas no momento que conectarem (AI-S6), isso vira bomba.

**Local:** `src/ai/conversation-orchestrator.ts:251-273`

**Recomendação:** Serializar tools de tipo `mutation` (executar em sequência), e/ou exigir uma única mutation por turn.

---

### E2. Mutations não têm rollback em caso de falha parcial [CRÍTICO]

`createContract` em `admin-actions.ts` insere `investments` + N `loan_installments`. Se a primeira falha após sucesso da segunda parte da operação, ou vice-versa, não há transação Supabase visível no caminho do bot.

`markInstallmentPaid` aplica baixa + atualiza saldos derivados (surplus, juros, multa). Se RLS rejeitar uma das updates intermediárias, parcela fica em estado inconsistente.

**Evidência:** o pipeline de mutation passa por `executors/create-contract.ts` (548 linhas) e `executors/mark-installment-paid.ts` (497 linhas), mas a chamada final delega para `createContract`/`markInstallmentPaid` em `admin-actions.ts:2346`. Não vi `rpc()` com função plpgsql transacional para essas mutações ao folhear (precisa confirmar com leitura completa de admin-actions.ts).

**Recomendação para Codex verificar:** Confirmar se `createContract` e `markInstallmentPaid` em `admin-actions.ts` envolvem suas escritas em RPC plpgsql ou múltiplas chamadas REST encadeadas.

---

### E3. Idempotency key da confirmação só cobre args, não cobre tenant [ALTO]

```ts
// confirmation-store.ts:7-17
function createIdempotencyKey(sessionId, capability, argsSnapshot) {
  const hash = createHash('sha1').update(JSON.stringify(argsSnapshot)).digest('hex').slice(0, 12);
  return `${sessionId}:${capability}:${hash}`;
}
```

Se o usuário confirmar a mesma operação duas vezes (replay de mensagem por bug do Telegram, retry do webhook), o key é igual, mas:

- Não há *armazenamento server-side* desse key — `pendingConfirmation` é deletada ao confirmar (clearPendingConfirmation, message-handler.ts:1530), e mutation é executada **sem checar** se aquela key já foi processada antes.
- Se webhook retentar 1 hora depois (TTL passou, confirmation expirou) com mesmo `messageId`, o dedup do `message-dedupe.ts` pode ter expirado também.

**Local:** `src/assistant/confirmation-store.ts:7-17, 30-61`, `src/handlers/message-handler.ts:1530-1547`

**Recomendação:** Persistir `idempotencyKey` em tabela `bot_mutation_log` antes de executar. Antes do INSERT real, fazer `INSERT ... ON CONFLICT DO NOTHING` no log; se conflict, pular execução (já feita).

---

### E4. Budget guard tem janela de race [ALTO]

`conversation-orchestrator.ts:133-140` checa budget *antes* de chamar Gemini. Mas:

- A leitura de `currentMonthCentsSpent` vem do cache de tenant config (60s TTL, system-prompt-builder.ts:37).
- O incremento do gasto não está visível no orchestrator — provavelmente roda após retorno (não vi código de update). Se a write para `bot_tenant_config.ai_current_month_cents_spent` é eventual, dois turnos paralelos podem ambos passar pelo guard antes de qualquer um incrementar.

**Local:** `src/ai/conversation-orchestrator.ts:133-140`, `src/ai/system-prompt-builder.ts:37, 64-118`

**Recomendação:** Usar `UPDATE ... RETURNING` atômico para débito do budget, ou fazer pre-charge antes do request.

---

### E5. Selectivamente, AI-native sai e cai no legacy mas estado pode ficar dirty [MÉDIO]

`message-handler.ts:1436-1441`:
```
if (result.reply && (result.source === 'fast_path' || result.source === 'llm' || result.source === 'budget_blocked')) {
  // persist + return
}
// else fallthrough para legacy
```

Se AI-native chamou tools (LLM acabou de executar `query_debtor_balance` mas retornou `source: 'error'` em algum branch raro), o legacy reprocessa a mensagem do zero. Tools chamadas no AI-native **não foram persistidas** em audit. Histórico do user só tem a mensagem original, não a tool call.

**Local:** `src/handlers/message-handler.ts:1436-1452`

**Impacto:** Custo duplicado (Gemini + Gemini), e em casos de side-effect (gerar convite!) executa duas vezes — `generate_invite` é mutation_applied no AI-native (handlers.ts:172-181).

**Recomendação:** Se AI-native produziu *qualquer* `mutation_applied`, retornar erro friendly em vez de cair no legacy.

---

### E6. Falha de `notWired` não invalida cache [MÉDIO]

Se um tenant chama `create_contract` 30× em 5 min:
- AI-native sempre chama Gemini (cache do orchestrator não bate em arg-shape diferente)
- Tool retorna `notWired` 30×
- Budget é consumido proporcionalmente

Não há circuit-breaker por tool. Não há "se essa tool falhou nas últimas N tentativas, retorne ao usuário com mensagem honesta sem chamar LLM".

**Local:** `src/ai/conversation-orchestrator.ts:299-345`

---

### E7. Buffer agrega mensagens de wizard ativo em uma só [MÉDIO]

`inbound-buffer.ts:142-146` concatena mensagens com vírgula:
```ts
const text = items.map(item => item.message.text.trim()).filter(Boolean).join(', ');
```

Se durante wizard de contrato o user manda em sequência rápida:
1. "12345678901"
2. "5000"
3. "12 vezes"

Eles viram `"12345678901, 5000, 12 vezes"` e vão como uma só msg ao classifier. O `extractAllContractEntities` (message-handler.ts:343-376) é robusto, mas isso pode confundir o intent classifier que vê 3 conteúdos heterogêneos.

`shouldBypassInboundBuffer` (index.ts:136-144) tem bypass para confirmações e números curtos, mas não para CPF (11 dígitos) nem para wizard ativo.

**Local:** `src/utils/inbound-buffer.ts:142-146`, `src/index.ts:136-144`

**Recomendação:** Quando `workingState.pendingCapability === 'create_contract'` (ou similar), o buffer debounce deve ser muito menor (500ms) ou bypass total — ler o working state antes de bufferizar é caro mas pode usar a flag última conhecida.

---

### E8. Política de role só checa allowlist, não checa propriedade do recurso [MÉDIO]

`policy-engine.ts:8-15` verifica `capability.rolesAllowed.includes(input.role)`. Suficiente para `show_dashboard` (admin-only), mas:

- `query_debtor_balance` é admin-only — mas e se admin de tenant A passa um `debtor_profile_id` de tenant B?
- A defesa atual depende de RLS Supabase — se um endpoint não tem RLS perfeita, vaza.

**Local:** `src/assistant/policy-engine.ts:8-15`

**Recomendação:** Tools que recebem ID de recurso devem validar `tenant_id` do recurso == `tenant_id` do request. Já é responsabilidade do handler/admin-actions, mas adicionar assert explícito no path do tool defende em profundidade.

---

### E9. `view_my_*` para debtor/investor não filtra por company [BAIXO]

Em multi-empresa (escopo "Empresarial"), o admin tem `activeCompany`. Mas `view_my_installments` (handlers.ts:186) chama `getUserDebtDetails(ctx.tenantId, profileId)` sem `companyId`. Se um devedor tem dívida em duas empresas do mesmo tenant, vê tudo agregado. **Pode ser intencional.**

**Local:** `src/ai/tools/handlers.ts:186-200`

**Recomendação Codex verificar:** Confirmar se devedor deve ver agregado ou por-empresa.

---

## 5. PROPOSTAS DE MELHORIA (priorizadas)

Cada proposta é independente e tem efeito mensurável. Esforço em dias-engenheiro.

### P1. Wirar mutations no AI-native (AI-S6) [3-5 dias]

**Resolve:** G1, G2

**Como:**
1. Em `src/ai/tools/handlers.ts`:
   - Substituir `notWired` em `createContractHandler`, `markInstallmentPaidHandler`, `disconnectBotHandler`, `configureBriefingHandler`, `previewLembreteHandler`.
   - Cada handler executa: validar args → criar `pendingConfirmation` (reusar `confirmation-store.ts`) → retornar `kind: 'preview'` com `safePreview` formatado e `confirmationId`.
   - Fluxo de "sim/não" continua via `pendingConfirmation` no handler legacy de `message-handler.ts:1469-1566`.
2. No system prompt de orchestrator, garantir regra clara: "Se a tool retornar `status: 'preview'`, **NÃO chame outra tool** — apenas mostre o `preview` ao usuário e aguarde a próxima mensagem."
3. Reduzir `MAX_TOOL_ITERATIONS` para 2 quando há preview pendente — força o LLM a parar.

**Risco:** LLM pode insistir em chamar a tool de novo. Mitigação: detectar `kind: 'preview'` no orchestrator e *forçar* return imediato ao usuário (não mais iterações).

---

### P2. Asserção de invariância "v1 ↔ v2" no working state [1 dia]

**Resolve:** G4

**Como:**
- Adicionar função `assertWorkingStateConsistent(context)` em `legacy-state-adapter.ts` que retorna lista de inconsistências (ex.: v1 tem `pendingAction='create_contract'` mas v2 tem `pendingCapability='mark_installment_paid'`).
- Chamar após cada `patchWorkingState` em modo dev/staging — log estruturado se inconsistência detectada.
- Em produção, log + métrica sem bloqueio (até confiar).
- Próximo passo (separado): deprecar v1 — substituir todos os reads por v2 puros.

---

### P3. Idempotência server-side para mutations [1-2 dias]

**Resolve:** E3

**Como:**
1. Criar tabela `bot_mutation_log (idempotency_key text PK, capability text, tenant_id uuid, profile_id uuid, args_hash text, applied_at timestamptz, result_summary text)`.
2. Em `tool-executor.ts` antes do execute de `kind:'mutation'`:
   ```sql
   INSERT INTO bot_mutation_log (idempotency_key, ...) ON CONFLICT DO NOTHING RETURNING applied_at;
   ```
   Se conflict (já existe), retornar `result_summary` salvo — não re-executar.
3. RLS na nova tabela: tenant_id = jwt_tenant.

**Test plan:**
- Reenviar webhook 2× → mutation aplicada 1×.
- Confirmar 2× consecutivos → segundo é no-op com mesma resposta.

---

### P4. Validação de tenant_id em handlers que recebem ID externo [0.5-1 dia]

**Resolve:** E8

**Como:**
- Em `queryDebtorBalanceHandler` (handlers.ts:125-156), antes de chamar `getUserDebtDetails`, fazer:
  ```ts
  const profile = await getProfileById(profileId); // SELECT id, tenant_id
  if (profile.tenant_id !== ctx.tenantId) {
    return { kind: 'error', message: 'Devedor não encontrado.', retryable: false };
  }
  ```
- Padronizar como helper `assertSameTenant(profileId, tenantId)` em admin-actions.

---

### P5. Assertion no response-generator de preservação de fatos [1 dia]

**Resolve:** G3

**Como:**
- Após `renderConversationalReply` retornar texto reescrito, rodar comparação:
  - Extrair tokens monetários (`R\$ ?[\d,.]+`), datas (`\d{2}/\d{2}/\d{4}`), CPFs (mask), nomes próprios em maiúsculas.
  - Se *qualquer* token presente em `baseText` não aparece em `rewritten`, descartar reescrita e retornar `baseText` original.
- Adicionar test em `__tests__/response-generator.spec.ts` com fixtures.
- Métrica: contar `response_rewrite_rejected` por dia.

---

### P6. Mostrar transcrição de áudio em todas as respostas [0.5 dia]

**Resolve:** G5

**Como:**
- Substituir `shouldPrependAudioPreview` (message-handler.ts:90-96) por: "se input foi áudio com `quality !== 'ok'` OU operação tem side-effect (mutação, confirmation, search específica), prepend transcript".
- Para queries simples (dashboard), continuar sem prepend (UX).

---

### P7. Buffer adaptativo durante wizard [0.5 dia]

**Resolve:** E7

**Como:**
- Em `index.ts:136`, expandir `shouldBypassInboundBuffer`:
  ```ts
  function shouldBypassInboundBuffer(text, sessionContext) {
    // existing checks
    const wsv2 = sessionContext?.workingState;
    if (wsv2?.pendingCapability === 'create_contract' || wsv2?.pendingCapability === 'mark_installment_paid') {
      return true; // wizard ativo: bypass
    }
    return false;
  }
  ```
- Custo: ler `session.context` antes de bufferizar (1 SELECT extra). Mitigação: cache em memória da última `pendingCapability` por `channel:user`.

---

### P8. Serializar tool calls de mutation no AI-native [1 dia]

**Resolve:** E1

**Como:**
- Em `conversation-orchestrator.ts:251`:
  ```ts
  const toolDefs = functionCalls.map(c => ({ call: c, def: getTool(c.name) }));
  const queries = toolDefs.filter(t => t.def?.kind === 'query');
  const mutations = toolDefs.filter(t => t.def?.kind === 'mutation');
  
  const queryResults = await Promise.all(queries.map(t => executeTool(t.call.name, t.call.args, args.input)));
  const mutationResults: ToolOutcome[] = [];
  for (const t of mutations) {
    mutationResults.push(await executeTool(t.call.name, t.call.args, args.input));
  }
  ```
- Justificativa: queries são read-only (paralelo é seguro). Mutations precisam ordem determinística.

---

### P9. Categorizar erros para usuário [1 dia]

**Resolve:** G6

**Como:**
- Definir `BotError extends Error` com `code: 'quota_exceeded' | 'tenant_misconfigured' | 'temporary' | 'permanent' | 'session_timeout' | 'auth' | ...`.
- Substituir `console.error` no catch raiz (message-handler.ts:1965) por handler que mapeia código → mensagem PT-BR + sugestão acionável.
- Se `temporary` → "Tente novamente em 30s". Se `permanent` → "Avise o administrador, código X-Y".

---

### P10. Circuit-breaker por tool no AI-native [1 dia]

**Resolve:** E6

**Como:**
- Em `conversation-orchestrator.ts:299` (executeTool):
  - Map `<toolName, {fails: number, until: number}>` em memória.
  - Se `fails >= 5` nas últimas 60s, retornar `{kind: 'error', message: 'Operação temporariamente indisponível...', retryable: true}` *sem* chamar o handler.
- TTL automático.

---

## 6. RISK REGISTER

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R1 | Mutation duplicada após webhook retry | Alta | Alto | P3 |
| R2 | LLM reescreve resposta com fato errado | Média | Alto | P5 |
| R3 | Tenant A vê dado de tenant B via ID externo | Baixa | Crítico | P4 + audit RLS |
| R4 | Wizard de contrato impossível por voz no AI-native | Alta | Médio | P1 + P2 |
| R5 | Budget excedido por race | Média | Médio | P3 + atomic UPDATE |
| R6 | OOM por dedup em memória | Baixa | Alto | LRU + max size |
| R7 | Roll-out canário derruba tenants ao falhar | Média | Alto | P10 + monitor `ai_native_error` |

---

## 7. PRIORIZAÇÃO RECOMENDADA

```
Sprint 1 (estabilidade):     P1, P2, P5
Sprint 2 (confiabilidade):   P3, P4, P10
Sprint 3 (UX):               P6, P7, P9
Sprint 4 (cleanup):          P8 + deprecação v1
```

Total: ~13-16 dias-eng. Sem P1 (wiring de mutations), o canário AI-native é praticamente inútil para 5 das 16 capabilities.

---

## 8. PARA O CODEX VERIFICAR

Pontos onde minha análise é **inferência** e seria bom o Codex confirmar lendo o código que não li totalmente:

1. **`admin-actions.ts:2346 linhas`** — confirmar se `createContract` e `markInstallmentPaid` usam RPC plpgsql ou múltiplos REST calls (relacionado a E2).
2. **`tool-executor.ts:969 linhas`** — só li até linha 200. Verificar se idempotency é usada na execução de mutation (E3).
3. **`message-handler.ts:3487 linhas`** — não li tudo. Verificar se há paths que atualizam só `pendingAction` v1 sem espelhar em `workingStateV2` (G4).
4. **`intent-router.ts` regras** — só li 200 das 729 linhas. Confirmar se há ambiguidades não resolvidas que caem em LLM mesmo quando regra deveria pegar.
5. **`legacy-state-adapter.ts`** — não li. Confirmar se `mirrorWorkingStateToContext` realmente mantém v1↔v2 sincronizados em **todos os campos**.
6. **Devedor multi-empresa** (E9) — confirmar BR.
7. **RPC plpgsql para budget** (E4) — confirmar se há `UPDATE ... RETURNING` atômico para `ai_current_month_cents_spent`.

---

**FIM**
