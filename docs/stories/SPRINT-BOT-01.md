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

Sprint de **1 frente** (bot). 5 itens. Commit realista: **P0 + P1** (BOT-FIX-001, BOT-001, TEST-001, BOT-002). BOT-003 é P2 (stretch).

| # | ID | Título | Prioridade | Tipo | Estado de entrada |
|---|----|--------|-----------|------|-------------------|
| 1 | BOT-FIX-001 | Baixa de parcela não é sequestrada por seleção de empresa | **P0** | FIX (código já feito) | Spec retroativa + QA + push |
| 2 | BOT-001 | Léxico de confirmação estreito em mutações sensíveis | **P0** | FEATURE/FIX | ✅ Implementada + QA PASS (commit/push pendente) |
| 3 | TEST-001 | Confiabilidade da suíte de testes do bot | **P1** | DÉBITO TÉCNICO | ✅ Implementada + QA PASS (AC-5 parcial) (commit/push pendente) |
| 4 | BOT-002 | Deprecar capabilities não-admin (bot é admin-only) | **P1** | LIMPEZA/PRODUTO | ✅ Implementada (gate, não remoção) + QA PASS (commit/push pendente) |
| 5 | BOT-003 | Wizard do briefing vaza antes do gate de policy | **P2** | FIX (baixo) | ✅ Implementada + QA PASS (commit/push pendente) |
| 6 | BOT-005 | Bot cria e baixa contratos bullet (juros simples) | **P1** | FEATURE | ✅ Implementada + QA PASS (commit/push pendente) |
| 7 | BOT-006 | Baixa por nome desambigua clientes homônimos | **P0** | FIX (segurança) | ✅ Implementada + QA PASS (commit/push pendente) |
| 8 | BOT-007 | LLM injeta contract_id do histórico → pula desambiguação por nome | **P0** | FIX (segurança) | ✅ Implementada + QA PASS + live (commit/push pendente) |

---

## BOT-FIX-001 — Baixa não sequestrada por seleção de empresa  `[P0]`

**Problema (achado live, prod-like):** com uma seleção de empresa pendente, o número que escolhe a *parcela* na baixa era capturado pelo follow-up de *seleção de empresa* (`"Vou considerar a empresa…"`), e o pagamento **não registrava**. Bug já estava em produção.

**Status do código:** ✅ já corrigido neste branch (não commitado).
- `src/handlers/message-handler.ts`: guarda `awaitingCapabilityInput` (= `!!workingState.pendingCapability`) no `candidateCompanyReply`; número de empresa fora do range agora responde "Não existe empresa número N (são X)".
- Regressão determinística: `cap-mark_installment_paid-company-selection-no-hijack` (contract-flows) — **provada** (falha sem o fix, passa com).

**Critérios de aceite:**
- [ ] Número que pertence a um fluxo de capability ativo nunca é tratado como seleção de empresa; comando explícito "usar empresa X" continua funcionando.
- [ ] Seleção de empresa com número inválido dá mensagem clara (não re-exibe em silêncio).
- [ ] Regressão determinística no gate + verificação live (baixa ponta-a-ponta = "Pagamento confirmado").

**Pipeline:** spec **retroativa** (documentar o que/porquê) → @qa *qa-gate (validar fix + cobertura) → @devops *push. Não precisa de @dev (código pronto). Sem mudança de schema.

---

## BOT-001 — Léxico de confirmação estreito  `[P0]`

**Problema (achado #1, chunk-03 32/50):** só `confirmo, isso, ok, pode, pode seguir, s, segue, sim` disparam a baixa/criação. Ignorados silenciosamente (caem em fallback degradado): `beleza, blz, bora, certo, combinado, isso mesmo, perfeito, pode confirmar, pode ser, ta, tá, yes`. Afeta exatamente os fluxos admin com `requiresConfirmation` (criar contrato, marcar pagamento).

**Critérios de aceite (rascunho — a spec detalha):**
- [ ] Palavras coloquiais de confirmação aceitas disparam a confirmação pendente.
- [ ] Sem falsos positivos: nada ambíguo ("pode ser que…") deve confirmar uma mutação por engano.
- [ ] Cancelamento (`não`, `cancela`, `deixa`) continua robusto.
- [ ] chunk-03 (confirm-lexicon) atinge alvo acordado na spec; casos verdes versionados.

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
- [ ] `getSupabaseClient` controlado nos testes; caso `fresh=null` (bug V44d) coberto + caso fresh com `amount_paid>0`.
- [ ] `expect.anything()` → `expect.objectContaining({ capability })` nos casos "ready".
- [ ] Eliminar drift de parser (importar `extract*`/`isValidCpf` reais ou validar dígito verificador real).
- [ ] Checks live com snippets significativos; conversa live cobre o cenário no-hijack.
- [ ] Ramos faltantes cobertos.
- [ ] **Mutações sem teste cobertas** (gap de breadth identificado na análise de cobertura 19/23): `set_eod_alert_hour` (mutação admin) e `disconnect_bot` (mutação com confirmação) ganham caso `cap-*` happy + deny. *(smalltalk_datetime/identity são utilitários de baixo risco — fora do escopo; áudio/canais ficam para sprint de robustez futura.)*

**Pipeline:** @pm spec (priorizar quais ressalvas são gate vs nice-to-have) → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## BOT-002 — Deprecar capabilities não-admin  `[P1]`

**Problema:** bot é **admin-only**, mas o registry ainda tem `view_my_installments`, `view_my_debt_summary` (debtor) e `view_my_portfolio` (investor) vivas — código que não roda em prod.

**Critérios de aceite (a spec decide remover vs gatear):**
- [ ] Decisão de produto registrada: remover ou bloquear formalmente as 3 capabilities não-admin.
- [ ] `capability-registry`, `action-planner` e testes (coverage-matrix happy-paths debtor/investor) atualizados conforme a decisão.
- [ ] Matriz de deny mantida como defense-in-depth (caso um não-admin seja linkado).

**Pipeline:** @pm spec (confirmar decisão admin-only) → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## BOT-003 — Wizard do briefing vaza antes do gate de policy  `[P2 / stretch]`

**Problema (rebaixado, não é bypass):** `configure_briefing` é `rolesAllowed:['admin']` e o policy-engine bloqueia a mutação para não-admin. Mas o wizard ("Me diga o horário") dispara *antes* do gate no action-planner → vaza o prompt (sem efeito de escrita). Severidade baixa num bot admin-only.

**Critérios de aceite:**
- [ ] Para não-admin, `configurar_briefing` responde o deny de policy, não o wizard.
- [ ] Caso na coverage-matrix deixa de ser soft-fail e vira deny verde.

**Pipeline:** @pm spec → @sm → @po validate → @dev → @qa → @devops. Sem schema.

---

## Sequência sugerida (dependências)

1. **BOT-FIX-001** primeiro (fix crítico já pronto → spec retroativa + QA + push) — desbloqueia prod.
2. **BOT-001** e **TEST-001** em paralelo (frentes independentes; TEST-001 endurece o gate que protege BOT-001).
3. **BOT-002** depois de BOT-001 (ambos mexem em registry/coverage-matrix — evita conflito).
4. **BOT-003** por último (stretch, baixo risco).

## Definição de Pronto (DoD) da sprint

- Cada item com spec aprovada antes de implementar.
- Gate determinístico (`npm test`) verde no CI (`deploy-bot.yml`) — bloqueia deploy.
- Validação live prod-like (`scripts/live-eval-dump.ts`) sem regressão nos fluxos sensíveis.
- Sem mudança de schema sem aprovação do guardião.
