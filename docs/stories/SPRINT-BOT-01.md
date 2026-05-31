# SPRINT-BOT-01 — e-finance-bot: fácil e confiável para o admin

> **PO:** Pax · **Criada:** 2026-05-30 · **Escopo:** e-finance-bot (admin-only) · **Metodologia:** Spec-Driven (obrigatória)
> **Sprint Goal:** garantir que os dois fluxos sensíveis do bot (criação de contrato e baixa de parcela) sejam confiáveis e fáceis de usar, e que a suíte de testes dê segurança real — não falsa.

---

## Princípio inegociável

**Nada implementa sem spec aprovada.** Todo item abaixo percorre o pipeline:

```
@pm *create-epic/spec → @sm *draft → @po *validate-story-draft → @dev *develop-story → @qa *qa-gate → @devops *push
```

Gates de banco (schema/RPC) exigem aprovação explícita do guardião antes do apply. Bot é **admin-only** — toda decisão de capability parte disso.

---

## Capacidade & commit

Sprint de **1 frente** (bot). Escopo documental normalizado em **8 stories + 1 subitem oficial**: BOT-FIX-001, BOT-001, TEST-001, BOT-002, BOT-003, BOT-005, BOT-006, BOT-008; BOT-007 permanece como subitem oficial de BOT-006. Estado atual: itens implementados e com QA PASS; sujeira fora do escopo segregada em stash; pendente autorização/execução de `@devops *push` (push = deploy prod).

| # | ID | Título | Prioridade | Tipo | Estado de entrada |
|---|----|--------|-----------|------|-------------------|
| 1 | BOT-FIX-001 | Baixa de parcela não é sequestrada por seleção de empresa | **P0** | FIX | ✅ Implementada + QA PASS |
| 2 | BOT-001 | Léxico de confirmação estreito em mutações sensíveis | **P0** | FEATURE/FIX | ✅ Implementada + QA PASS (commit/push pendente) |
| 3 | TEST-001 | Confiabilidade da suíte de testes do bot | **P1** | DÉBITO TÉCNICO | ✅ Implementada + QA PASS (AC-5 parcial) (commit/push pendente) |
| 4 | BOT-002 | Deprecar capabilities não-admin (bot é admin-only) | **P1** | LIMPEZA/PRODUTO | ✅ Implementada (gate, não remoção) + QA PASS (commit/push pendente) |
| 5 | BOT-003 | Wizard do briefing vaza antes do gate de policy | **P2** | FIX (baixo) | ✅ Implementada + QA PASS (commit/push pendente) |
| 6 | BOT-005 | Bot cria e baixa contratos bullet (juros simples) | **P1** | FEATURE | ✅ Ready for Review — QA PASS + live; push/deploy pendente |
| 7 | BOT-006 | Baixa por nome desambigua clientes homônimos | **P0** | FIX (segurança) | ✅ Ready for Review — QA PASS + live; push/deploy pendente |
| 8 | BOT-007 | LLM injeta contract_id do histórico → pula desambiguação por nome | **P0** | FIX (segurança) / subitem de BOT-006 | ✅ Oficializado dentro da BOT-006; QA PASS + live |
| 9 | BOT-008 | Bullet no caminho AI-native (paridade) — feature chega aos 4 tenants AI-native | **P0** | FIX (paridade) | ✅ Ready for Review — QA PASS + live AI-native 12/12; push/deploy pendente |

---

## BOT-FIX-001 — Baixa não sequestrada por seleção de empresa  `[P0]`

**Problema (achado live, prod-like):** com uma seleção de empresa pendente, o número que escolhe a *parcela* na baixa era capturado pelo follow-up de *seleção de empresa* (`"Vou considerar a empresa…"`), e o pagamento **não registrava**. Bug já estava em produção.

**Status do código:** ✅ já corrigido neste branch.
- `src/handlers/message-handler.ts`: guarda `awaitingCapabilityInput` (= `!!workingState.pendingCapability`) no `candidateCompanyReply`; número de empresa fora do range agora responde "Não existe empresa número N (são X)".
- Regressão determinística: `cap-mark_installment_paid-company-selection-no-hijack` (contract-flows) — **provada** (falha sem o fix, passa com).

**Critérios de aceite:**
- [x] Número que pertence a um fluxo de capability ativo nunca é tratado como seleção de empresa; comando explícito "usar empresa X" continua funcionando.
- [x] Seleção de empresa com número inválido dá mensagem clara (não re-exibe em silêncio).
- [x] Regressão determinística no gate + verificação live (baixa ponta-a-ponta = "Pagamento confirmado").

**Pipeline:** spec **retroativa** (documentar o que/porquê) → @qa *qa-gate (validar fix + cobertura) → @devops *push. Não precisa de @dev (código pronto). Sem mudança de schema.

---

## BOT-001 — Léxico de confirmação estreito  `[P0]`

**Problema (achado #1, chunk-03 32/50):** só `confirmo, isso, ok, pode, pode seguir, s, segue, sim` disparam a baixa/criação. Ignorados silenciosamente (caem em fallback degradado): `beleza, blz, bora, certo, combinado, isso mesmo, perfeito, pode confirmar, pode ser, ta, tá, yes`. Afeta exatamente os fluxos admin com `requiresConfirmation` (criar contrato, marcar pagamento).

**Critérios de aceite:**
- [x] Palavras coloquiais de confirmação aceitas disparam a confirmação pendente.
- [x] Sem falsos positivos: nada ambíguo ("pode ser que…") deve confirmar uma mutação por engano.
- [x] Cancelamento (`não`, `cancela`, `deixa`) continua robusto.
- [x] chunk-03 (confirm-lexicon) atinge alvo acordado na spec; casos verdes versionados.

**Pipeline:** @pm spec (definir léxico + política de ambiguidade — equilíbrio recall × falso positivo numa mutação financeira) → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## TEST-001 — Confiabilidade da suíte de testes do bot  `[P1]`

**Problema (auditoria Opus):** a suíte pega regressões reais nos caminhos principais, mas tem pontos de confiança falsa:
1. `getSupabaseClient` não-mockado no harness → baixa `confirm-success` passa pelo *fallback*, não pelo fresh-read (caminho do bug V44d **sem teste**).
2. `pendingConfirmation: expect.anything()` é fraco — não valida a capability/draft corretos.
3. Parser duplicado no mock (`extractAmount/Rate/...`, `isValidCpf`) → drift com o parser de produção.
4. Suíte live com ~1/3 dos checks de snippet vazio (`[]`) → "16/16" inflado; não reproduz o cenário no-hijack.
5. Lacunas: `installment_id` pré-resolvido, `mostrar mais` página vazia, seleção por nome, one-shot via `parseContractTextWithMeta`, `fresh=null`/comprovante.

**Critérios de aceite:**
- [x] `getSupabaseClient` controlado nos testes; caso `fresh=null` (bug V44d) coberto + caso fresh com `amount_paid>0`.
- [x] `expect.anything()` → `expect.objectContaining({ capability })` nos casos "ready".
- [x] Eliminar drift de parser (importar `extract*`/`isValidCpf` reais ou validar dígito verificador real).
- [x] Checks live com snippets significativos; conversa live cobre o cenário no-hijack.
- [x] Ramos faltantes cobertos.
- [x] **Mutações sem teste cobertas** (gap de breadth identificado na análise de cobertura 19/23): `set_eod_alert_hour` (mutação admin) e `disconnect_bot` (mutação com confirmação) ganham caso `cap-*` happy + deny. *(smalltalk_datetime/identity são utilitários de baixo risco — fora do escopo; áudio/canais ficam para sprint de robustez futura.)*

**Pipeline:** @pm spec (priorizar quais ressalvas são gate vs nice-to-have) → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## BOT-002 — Deprecar capabilities não-admin  `[P1]`

**Problema:** bot é **admin-only**, mas o registry ainda tem `view_my_installments`, `view_my_debt_summary` (debtor) e `view_my_portfolio` (investor) vivas — código que não roda em prod.

**Critérios de aceite:**
- [x] Decisão de produto registrada: remover ou bloquear formalmente as 3 capabilities não-admin.
- [x] `capability-registry`, `action-planner` e testes (coverage-matrix happy-paths debtor/investor) atualizados conforme a decisão.
- [x] Matriz de deny mantida como defense-in-depth (caso um não-admin seja linkado).

**Pipeline:** @pm spec (confirmar decisão admin-only) → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## BOT-003 — Wizard do briefing vaza antes do gate de policy  `[P2 / stretch]`

**Problema (rebaixado, não é bypass):** `configure_briefing` é `rolesAllowed:['admin']` e o policy-engine bloqueia a mutação para não-admin. Mas o wizard ("Me diga o horário") dispara *antes* do gate no action-planner → vaza o prompt (sem efeito de escrita). Severidade baixa num bot admin-only.

**Critérios de aceite:**
- [x] Para não-admin, `configurar_briefing` responde o deny de policy, não o wizard.
- [x] Caso na coverage-matrix deixa de ser soft-fail e vira deny verde.

**Pipeline:** @pm spec → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## Expansão BOT-005..BOT-008 — estado documental consolidado

- **BOT-005:** story `BOT-005-bot-cria-e-baixa-bullet.story.md` normalizada para `Ready for Review`; evidências registradas: `npm test` **302 passed / 4 skipped**, `tsc --noEmit` 0, live bullet **11/11**.
- **BOT-006:** story `BOT-006-baixa-desambigua-cliente-homonimo.story.md` normalizada para `Ready for Review`; QA Gate explicitado por AC; evidências registradas: stress **8/8**, depois **10/10** com BOT-007, `npm test` **312 passed / 4 skipped**, live com `baixa_desambigua: true`.
- **BOT-007:** decisão registrada como **subitem oficial de BOT-006**, sem story própria, por ser a mesma classe de risco/fix/gate (homônimos na baixa com `contract_id` inferido pelo LLM).
- **BOT-008:** story `BOT-008-bullet-no-caminho-ai-native.story.md` normalizada para `Ready for Review`; File List consolidado inclui schema das tools, handlers, teste AI-native e harness live path-aware; evidência final: live AI-native **12/12** + `npm run lint`, `npm run typecheck`, `npm test` (**377 passed / 4 skipped**) e `npm run build`. Follow-up adversarial 2026-05-31 cobre multi-turn de criação, parser `cinco mil`/`todo dia 10`, gírias de baixa, consulta read-only por contrato e tentativa Claude Code/Supabase bloqueada por falta de grant MCP.

## Triage — sujeira fora do escopo BOT-005/006/008

Segregado sem apagar trabalho em stash commits estáveis: `074de07f072b4b442a96f621aeb697837344e97e` (`triage-out-of-scope-bot005-006-008`) para sujeira fora do escopo; `cf96af5bce0eca78e2cd804b1e3878af940f18cd` e `469e67e7afb766b50866c1f9839488f2055e277c` para artefatos gerados pelos gates locais.

- Stories/docs fora de BOT: `docs/stories/FX-001-fix-prazo-inadimplencia-undefined.story.md`, `docs/stories/FX-002-forms-color-token-normalization.story.md`, `docs/stories/CB-002-po-caderneta-bullet-regularizacao-gate.story.md`, `docs/qa/cb-001-evidence/debug-no-sidebar.png`.
- Arquivos de agente/config/chunks fora do recorte documental BOT: `.agents/`, `skills-lock.json`, `e-finance-bot/.gitignore`, `e-finance-bot/tests/evals/chunks/chunk-01-single.ts`, `chunk-02-multi.ts`, `chunk-05-regression.ts`, `chunk-06-adversarial.ts`.
- Artefatos gerados por gates locais: `e-finance-bot/artifacts/`.
- Arquivos funcionais/testes mantidos no working tree porque pertencem ao escopo BOT-005/006/008 ou à limpeza necessária para os gates: `e-finance-bot/scripts/live-bullet-cycle.ts`, `e-finance-bot/src/actions/admin-actions.ts`, `e-finance-bot/src/ai/intent-router.ts`, `e-finance-bot/src/ai/response-generator.ts`, `e-finance-bot/src/ai/tools/definitions/mutations.ts`, `e-finance-bot/src/ai/tools/definitions/queries.ts`, `e-finance-bot/src/ai/tools/handlers.ts`, `e-finance-bot/src/assistant/executors/create-contract.ts`, `e-finance-bot/src/assistant/executors/mark-installment-paid.ts`, `e-finance-bot/src/handlers/message-handler.ts`, `e-finance-bot/tests/admin-actions.test.ts`, `e-finance-bot/tests/ai-native-handlers.test.ts`, `e-finance-bot/tests/evals/probe-create.ts`, `e-finance-bot/tests/intent-router.test.ts`, `e-finance-bot/tests/probe-baixa.test.ts`, `e-finance-bot/tests/probe-create.test.ts`.

---

## Sequência sugerida (dependências)

1. **BOT-FIX-001** concluído e já na base do branch.
2. **BOT-001 + TEST-001 + BOT-002 + BOT-003** concluídos com QA PASS.
3. **BOT-005** concluído com QA PASS + live bullet.
4. **BOT-006 + BOT-007(subitem)** concluídos com QA PASS + live homônimos.
5. **BOT-008** concluído com QA PASS + live AI-native 12/12.
6. Próximo passo seguro: `@devops *push` mediante autorização explícita.

## Definição de Pronto (DoD) da sprint

- Cada item com spec aprovada antes de implementar.
- Gate determinístico (`npm test`) verde no CI (`deploy-bot.yml`) — bloqueia deploy.
- Validação live prod-like (`scripts/live-eval-dump.ts`) sem regressão nos fluxos sensíveis.
- Sem mudança de schema sem aprovação do guardião.
