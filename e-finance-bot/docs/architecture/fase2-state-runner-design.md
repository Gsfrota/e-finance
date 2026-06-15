# Fase 2 — CORREÇÃO DE ROTA: o executor já existe; converger, não recriar

> **Status:** Design revisado (2026-06-14) após inspeção do código. **Corrige** a versão anterior
> (que propunha um `state-runner.ts` novo). Ver `bot-deterministic-engine.md` e `parity-baseline.md`.
> **Nenhum código de produção até este design ser aprovado** (spec-driven).

## O que a inspeção revelou (e por que mudou o plano)

Antes de construir um executor de grafo, inspecionei o código e achei que **ele já existe**:

1. **Existe uma máquina de estados de `create_contract` no modelo novo** —
   `src/assistant/executors/create-contract.ts` (`createContractCapability`): `resolve → authorize →
   execute → formatResult`, com slot-filling determinístico (`getMissingFields`/`getClarificationMessage`,
   ordem BR-BOT-010), tratamento de conflito de CPF×nome (`rename_mode`) e bullet (BR-BOT-011).
2. **Está registrada e ativa** — `capability-registry.ts:53`, executada pelo `tool-executor.ts`
   (resolve:260, execute:385). O pipeline determinístico chama `executeActionPlan` (message-handler:1642,
   2033).
3. **Já é idempotente** — `tool-executor.ts:333` chama `isReplayMutation(...)` que compara
   `workingState.lastMutation.idempotencyKey` (:203) e **bloqueia re-execução antes de rodar**. Ou seja, o
   "2 sim = 2 contratos" **não acontece** por esse caminho.

**Então construir `state-runner.ts` + pack seria uma TERCEIRA implementação paralela** de create_contract —
exatamente a duplicação que o blueprint condena. Decisão: **não criar engine novo.**

## O verdadeiro problema (redefinido)

Há **dois** create_contract vivos em paralelo:

| Caminho | Onde | Idempotente? | Papel |
|---|---|---|---|
| **Capability** (`createContractCapability` via `tool-executor`) | `executors/create-contract.ts` | ✅ sim (`isReplayMutation`) | modelo-alvo |
| **Legado** (`pendingAction='criar_contrato'` + `pendingStep`) | `message-handler.ts:2426`, `:2878+` | ❌ **não** (chama `createContract()` direto) | a aposentar |

O **bug de duplicação é exclusivo do legado**. O blueprint da Fase 2 ("executor único") se realiza
**convergindo no caminho capability e aposentando o wizard legado** — não inventando um terceiro.

## Fase 2 corrigida — convergência (não recriação)

1. **Caracterizar o alvo (ISOLADO, zero risco):** suíte de testes que tranca o comportamento de
   `createContractCapability` — slot-filling em cada ordem, conflito de nome (`rename_mode`), bullet, e a
   **guarda de idempotência** (`isReplayMutation` no replay de confirmação). Vira o alvo de convergência
   provado. *Sem tocar produção.*
2. **Rotear o legado pro capability:** os pontos de entrada do wizard legado em `message-handler`
   (`dispatchIntent` case `criar_contrato` :2426, e o loop `pendingStep` :2878+) passam a delegar ao
   `executeActionPlan`/capability. O `pendingStep` é removido quando o último consumidor sair. Atrás de
   flag `features.fsm_via_capability` (default off → rollback instantâneo).
3. **Strings → `t(key)`:** ao mexer nos prompts, os ~30 literais (`message-handler.ts:431-443` etc. e os de
   `executors/create-contract.ts:383-403`) entram no catálogo `contract.*`. Fase 1 absorvida aqui.
4. **Idempotência do legado:** enquanto o legado existir, blindar o `createContract()` direto (ou já estar
   coberto porque o legado some). Decisão do usuário foi **sim** — o caminho capability já cumpre; falta só
   o legado, que a convergência elimina.

## Primeiro slice (ISOLADO, recomendado)

**Caracterização de `createContractCapability` + idempotência** — `tests/engine/create-contract-capability.test.ts`:
cobre resolve (slot-filling por campo faltante), execute (sucesso, conflito de nome, erro transitório) e o
replay-guard. Reusa o harness/mocks de `tests/evals/`. Trava o alvo antes de qualquer reroteamento.
**Não cria engine, não toca message-handler.** Cresce o `test:parity`.

## Decisão que preciso de você
O design anterior (state-runner novo) está **descartado**. Confirmar a rota de **convergência** acima e que
o 1º slice é a **suíte de caracterização** do capability (isolada), antes de rotear o legado.
