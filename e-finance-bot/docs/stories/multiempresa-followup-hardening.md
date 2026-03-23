# Story: Multiempresa Follow-up Hardening

## Objetivo

Alinhar o fluxo proativo de cobrança e os alertas operacionais ao schema real do Supabase, respeitando tenants com `followup_enabled` e removendo premissas incorretas sobre tabela e colunas de configuração.

Observação validada no banco real: o admin enxerga múltiplas empresas do mesmo tenant por escopo de tenant no backend/web, enquanto `profiles.company_id` continua sendo um único vínculo opcional. O bot precisa manter contexto de empresa ativo no chat sem inventar membership n:n inexistente.

## Checklist

- [x] Validar nomes reais de tabelas, colunas e RPCs com o banco via wrapper local do Claude
- [x] Corrigir leitura de configuração legada de `bot_tenant_configs` para `bot_tenant_config`
- [x] Respeitar `followup_enabled` no scheduler de cobrança proativa
- [x] Filtrar parcelas por `loan_installments.tenant_id` nas queries de follow-up/baixa para reduzir dependência de join obrigatório
- [x] Cobrir regressões de router e alertas com testes
- [x] Cobrir a conversa proativa em múltiplos turnos com seleção parcial de baixas
- [x] Aceitar resposta livre com nomes dos devedores que não pagaram
- [x] Isolar o follow-up proativo por `company_id` do admin, além de `tenant_id`
- [x] Permitir ao admin listar empresas, ativar uma empresa no chat e voltar ao consolidado do tenant
- [x] Entender empresa na mesma frase operacional, como `dashboard da empresa X`
- [x] Aceitar apelidos e referências vagas de empresa, como `matriz`, `filial` e `empresa 2`
- [x] Pedir clarificação quando o apelido da empresa for ambíguo
- [x] Adicionar observabilidade por tenant e empresa nas execuções administrativas
- [x] Cobrir multiempresa em evals conversacionais permanentes
- [x] Estender o smoke live/E2E para listar e selecionar empresa real no banco
- [x] Criar um comando de regressão focado no bot conversacional

## File List

- `src/actions/admin-actions.ts`
- `src/actions/bot-config-actions.ts`
- `src/alerts/connection-alert.ts`
- `src/assistant/contracts.ts`
- `src/assistant/tool-executor.ts`
- `src/scheduler/briefing-router.ts`
- `src/scheduler/morning-briefing.ts`
- `src/scheduler/payment-followup.ts`
- `src/session/session-manager.ts`
- `tests/briefing-router.test.ts`
- `tests/conversation-smoke.test.ts`
- `tests/connection-alert.test.ts`
- `tests/message-handler.test.ts`
- `tests/payment-followup.test.ts`
- `tests/evals/harness.ts`
- `tests/evals/dataset.ts`
- `tests/nlu-curated-eval.test.ts`
- `scripts/live-e2e-bot-test.ts`
- `src/observability/logger.ts`
- `package.json`
- `docs/stories/multiempresa-followup-hardening.md`
