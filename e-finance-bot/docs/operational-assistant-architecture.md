# Operational Assistant Architecture

## Objetivo
Evoluir o `e-finance-bot` de um roteador de intents isoladas por mensagem para um assistente operacional híbrido:

- entendimento natural com custo baixo
- contexto curto útil por sessão
- follow-up simples sem depender de histórico bruto longo
- execução determinística e tenant-scoped
- naturalização final via LLM, sem entregar regra de negócio ao modelo

## Pipeline Atual
O fluxo principal em `src/handlers/message-handler.ts` agora é:

1. webhook/canal
2. sessão + sync de vínculo do canal
3. guardrails
4. transcrição/entrada multimodal
5. pending confirmation
6. pending action legado
7. follow-up resolver
8. command understanding
9. action planner
10. policy check
11. tool executor
12. naturalização final

## Módulos Novos
### `src/assistant/contracts.ts`
Contratos centrais da camada operacional:

- `ActionPlan`
- `ConversationWorkingState`
- `CapabilityDefinition`
- `PolicyCheckInput`
- `ExecutionResult`
- `ResolvedTimeWindow`

### `src/assistant/working-state-store.ts`
Abstrai leitura e escrita de `workingState` dentro de `bot_sessions.context`.

Responsabilidades:

- TTL do estado curto
- merge seguro com contexto legado
- atualização centralizada

### `src/assistant/followup-resolver.ts`
Resolve follow-ups curtos antes de nova classificação completa.

Hoje cobre:

- `o outro`, número e final de CPF para homônimos
- `e amanhã?`, `próximos X dias`, `próximos X meses`
- refinamento de parcela quando já existe contrato em foco

### `src/assistant/command-understanding.ts`
Camada de entendimento operacional.

Responsabilidades:

- smalltalk utilitário (`quem é você`, `que dia é hoje`)
- detecção direta de janelas em meses
- fallback para `intent-router`
- busca de histórico compacto só quando necessário

### `src/assistant/action-planner.ts`
Converte entendimento em `ActionPlan` único e explícito.

### `src/assistant/capability-registry.ts`
Lista capacidades permitidas, papel permitido e se exige confirmação.

### `src/assistant/policy-engine.ts`
Bloqueio central por role/perfil/tenant antes da execução.

### `src/assistant/confirmation-store.ts`
Confirmações sensíveis persistidas no `workingState`.

Hoje já governa `disconnect_bot`.

### `src/assistant/tool-executor.ts`
Executor operacional:

- executa utilidades diretamente
- consulta janela por faixa de datas explícita
- resolve dívida de cliente com desambiguação por CPF
- delega ações legadas complexas para `dispatchIntent`

## Compatibilidade com o Fluxo Legado
O state machine existente em `message-handler.ts` continua responsável por:

- `criar_contrato`
- `marcar_pagamento`
- `marcar_pagamento_contrato`
- `marcar_pagamento_por_mes`
- conflitos CPF/nome

A camada nova fica acima desse fluxo e evita reescrita total.

## Decisões Importantes
- Regras financeiras continuam em `admin-actions.ts`.
- O LLM não escreve regra nem decide autorização.
- `query_receivables_window` e `query_collection_window` agora usam faixa explícita de datas.
- `searchUser` com múltiplos resultados não depende mais de `pendingAction`; usa `workingState`.
- O patch de `workingState` não pode sobrescrever `pendingAction` legado criado no mesmo request.

## Observabilidade
Novos sinais:

- `followup_resolved`
- `action_plan_created`
- `policy_check`
- `tool_execution`

Novos campos de latência:

- `followupMs`
- `policyMs`
- `executorMs`
- `naturalizeMs`

## Próximo passo recomendado
Migrar gradualmente as mutações legadas de `dispatchIntent` para `tool-executor`, começando por:

1. `create_contract`
2. `mark_installment_paid`
3. `generate_report`

Isso fecha a arquitetura alvo sem big bang rewrite.
