# BOT-FIX-001 — [BUG] Baixa de parcela sequestrada por seleção de empresa pendente

**Agente:** @dev (impl — concluída) / @qa (gate) / @devops (push)
**Status:** Ready for Review
**Criada em:** 2026-05-30
**Origem:** Teste live prod-like (`scripts/live-eval-dump.ts`) contra Gemini + Supabase reais — sessão de QA do bot
**Sprint:** SPRINT-BOT-01
**Prioridade:** P0 — bug em produção que impede o registro de pagamento
**Banco:** sem mudança de schema/RPC

> Spec **retroativa**: a correção foi implementada e validada durante a sessão de QA. Esta story documenta problema, causa-raiz, critérios e evidências para o gate de QA antes do push (código pronto, não passa por @dev).

---

## 1. Problema

No bot (admin-only), com uma **seleção de empresa pendente** (`pendingCompanySelection=true`), o número que o admin envia para escolher a **parcela** numa baixa era capturado pelo follow-up de **seleção de empresa** — não pela seleção de parcela. Resultado: o pagamento **não era registrado** e o usuário ficava sem entender.

### Repro (transcript live real)
```
👤 quais empresas eu tenho?      → lista empresas (pendingCompanySelection=true)
👤 2                             → (número fora do range) re-exibia a lista em silêncio, mantendo pendente
...
👤 baixar contrato 3546          → lista as parcelas, pede "Responda com o número da parcela"
👤 1                             → 🤖 "Vou considerar a empresa ... nas próximas consultas"   ← SEQUESTRO
👤 sim                           → 🤖 "Não há uma confirmação pendente agora."                 ← baixa nunca ocorreu
```

## 2. Causa-raiz

1. `patchWorkingState` é **shallow-merge** (`working-state-store.ts`): `pendingCompanySelection=true` setado por `isCompanyListCommand` sobrevive ao patch da capability de baixa.
2. `shouldAcceptCompanyCandidateReply` aceita **qualquer** número `/^\d{1,2}$/` quando há seleção de empresa pendente.
3. O bloco de seleção de empresa roda **antes** do pipeline do assistant em `message-handler.ts` → o número da parcela é interceptado.
4. Agravante: número de empresa fora do range caía em `kind:'none'` → re-exibia a lista **sem erro e mantinha o flag pendente**, perpetuando a colisão.

## 3. Acceptance Criteria

### AC-1: Número de fluxo ativo não vira seleção de empresa
**Dado** que há uma capability ativa aguardando entrada (`pendingCapability` setado — ex.: escolher parcela na baixa, slot numérico na criação)
**Quando** o admin envia um número
**Então** o número é tratado pelo fluxo da capability, **não** pela seleção de empresa.

### AC-2: Comando explícito de empresa preservado
**Dado** qualquer momento
**Quando** o admin envia "usar empresa X" / "selecionar empresa X"
**Então** a troca de empresa acontece normalmente (comando explícito mantém prioridade).

### AC-3: Número de empresa inválido com mensagem clara
**Dado** a lista de empresas exibida
**Quando** o admin envia um número fora do range
**Então** o bot responde "Não existe empresa número *N* na lista (são X)." em vez de re-exibir em silêncio.

### AC-4: Baixa fecha ponta-a-ponta com seleção de empresa pendente
**Dado** o cenário de repro (lista empresas → baixar contrato → número da parcela)
**Quando** o admin confirma com "sim"
**Então** a parcela é baixada e o bot responde "Pagamento confirmado" (capability `mark_installment_paid` executada 1×).

## 4. Implementação (concluída)

### `src/handlers/message-handler.ts`
- **Guarda `awaitingCapabilityInput`** (= `Boolean(workingState.pendingCapability)`) adicionada à condição `candidateCompanyReply`: resposta numérica/implícita só é seleção de empresa quando **não** há capability ativa. `explicitCompanySelection` ("usar empresa X") permanece independente → AC-1 + AC-2.
- **Número de empresa fora do range**: ramo `!selectedCompany` agora prefixa "Não existe empresa número *N* na lista (são X)." quando o texto é `/^\d{1,2}$/` → AC-3.

## 5. Evidências de teste

### Regressão determinística (prova causal)
- `cap-mark_installment_paid-company-selection-no-hijack` em `tests/evals/contract-flows.ts`: lista empresas → baixar contrato → "1" deve dar `Baixar parcela — confirmar` e **excluir** "Vou considerar a empresa".
- **Provado:** removendo a guarda `!awaitingCapabilityInput`, o teste **FALHA** (1 failed); com a guarda, **PASSA**. (verificado via toggle + `npx vitest run`).

### Gate determinístico
- `tests/contract-flows.test.ts`: **41/41** ✅
- `npm test` completo: **288 passed / 4 skipped** ✅ · `tsc --noEmit` exit 0

### Live prod-like (Gemini + Supabase reais, tenant descartável)
- Re-rodado pós-fix: **16/16 checks**, baixa ponta-a-ponta → `"1"` → "Confirmando a baixa da parcela 1" → `"sim"` → "Pagamento confirmado, contrato 3547" → AC-4. Seleção de empresa "2" agora válida → "Vou considerar a empresa…".

## 6. File List

| Arquivo | Mudança |
|---------|---------|
| `e-finance-bot/src/handlers/message-handler.ts` | guarda `awaitingCapabilityInput` + mensagem de empresa inválida |
| `e-finance-bot/tests/evals/contract-flows.ts` | +caso de regressão `cap-mark_installment_paid-company-selection-no-hijack` (e suíte completa de criação/baixa) |
| `e-finance-bot/tests/contract-flows.test.ts` | gate dedicado (verde obrigatório) |
| `e-finance-bot/tests/eval-dump.test.ts` | `byCapability` passa a somar a suíte `contract-flows` |
| `e-finance-bot/scripts/live-eval-dump.ts` | cria 2 empresas (seleção real) + checks com conteúdo significativo |

## 7. QA Gate (@qa — 2026-05-30)

- [x] AC-1..AC-4 verificados (regressão determinística + transcript live pós-fix)
- [x] Regressão confirmada: toggle da guarda `!awaitingCapabilityInput` → teste FALHA sem o fix, PASSA com o fix
- [x] Sem regressão na suíte completa: `npm test` 288 passed / 4 skipped; `tsc --noEmit` 0; `npm run build` ok
- [x] Nenhuma mudança de schema/RPC
- ⚠️ Observação (fora do escopo): `npm run lint` tem **9 erros pré-existentes** (4 runtime: response-generator/handlers/mark-installment-paid:536; 5 em `chunks/chunk-06` morto) — já vermelhos no `main` antes desta mudança; CI (`deploy-bot.yml`) gateia por `npm test`, não por lint. Recomendado CHORE separado de limpeza (ver TEST-001).
- **Verdict:** ✅ **PASS** — pronto para `@devops *push`.

## 8. Notas

- Bug **já estava em produção** — push leva a correção pro Cloud Run via `deploy-bot.yml`.
- Relaciona-se às demais ressalvas de teste em **TEST-001** (o caminho fresh-read do comprovante ainda não é exercitado; cobertura endurecida lá).
