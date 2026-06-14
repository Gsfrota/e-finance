-- ============================================================================
-- Migration I18N-001 — Coluna `messages` jsonb em bot_tenant_config
-- ============================================================================
-- Data: 2026-06-14
-- APLICADA: 2026-06-14 via MCP (supabase migration 20260614200718_bot_messages_i18n).
--   Revisada por Gemini + Codex (3 rodadas). Validada pós-apply: 6/6 linhas '{}',
--   RLS intacta (2 policies tenant-scoped), CHECK rejeita não-string/array.
-- Arquitetura: e-finance-bot/docs/architecture/bot-deterministic-engine.md (Fase 1)
--              e-finance-bot/docs/architecture/parity-baseline.md
--
-- ⚠️ Gate do guardião do banco:
--    - Schema real inspecionado antes (via src/actions/bot-config-actions.ts:
--      bot_tenant_config é tenant-scoped, onConflict 'tenant_id', sem coluna
--      jsonb hoje). Tabela "escopo tenant-only" (database_schema.md:285).
--    - Mudança ADITIVA e reversível: só adiciona 1 coluna; nenhuma coluna/linha
--      existente é tocada; default '{}' não quebra leituras atuais (SELECT *).
--    - RLS inalterada: bot_tenant_config é RLS-on com 2 policies tenant-scoped
--      (admin_read_bot_config SELECT + admin_write_bot_config ALL, ambas
--      tenant_id = get_tenant_id_safe() AND role=admin); bot acessa via
--      service_role (bypass). ADD COLUMN herda as policies — RLS row-level não
--      muda. Bônus: admin do tenant pode editar `messages` pela própria UI.
--    - Aprovação explícita do usuário antes do apply. Validação após (queries no
--      rodapé). Rollback: context/rollback_bot_messages_i18n.sql
--
-- Propósito: externalizar strings PT-BR hoje hardcoded no código para um override
-- por tenant, editável sem deploy. O bot lê messages[key] e cai no default
-- embutido no código quando a chave não existe (helper t(key) — Fase 1a).
-- Multi-tenant preservado: o override é por linha (1 por tenant).
-- ============================================================================

BEGIN;

ALTER TABLE public.bot_tenant_config
  ADD COLUMN IF NOT EXISTS messages jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Valida o contrato chave→texto no nível do banco: messages deve ser um objeto
-- JSON cujos valores são TODOS strings (nunca array/escalar no topo; nunca
-- número/null/objeto nos valores). CHECK não aceita subquery, por isso a regra
-- vive numa função IMMUTABLE referenciada pela constraint.
CREATE OR REPLACE FUNCTION public.bot_tenant_config_messages_valid(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public'
AS $$
  -- CASE (não AND) porque o SQL não garante short-circuit: jsonb_each() em
  -- valor não-objeto lança erro; o guard precisa rodar ANTES dela.
  SELECT CASE
    WHEN jsonb_typeof(p) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) AS e WHERE jsonb_typeof(e.value) <> 'string'
    )
  END;
$$;

ALTER TABLE public.bot_tenant_config
  DROP CONSTRAINT IF EXISTS bot_tenant_config_messages_is_object;
ALTER TABLE public.bot_tenant_config
  ADD CONSTRAINT bot_tenant_config_messages_is_object
  CHECK (public.bot_tenant_config_messages_valid(messages));

COMMENT ON COLUMN public.bot_tenant_config.messages IS
  'Override de mensagens PT-BR por tenant (chave→texto), editável sem deploy. '
  'Fonte de verdade dos defaults é o código (helper t(key)); este JSONB só '
  'sobrescreve chaves específicas. Objeto vazio = usa todos os defaults.';

COMMIT;

-- ============================================================================
-- Validação pós-apply (com aprovação):
--   -- coluna existe, tipo e default corretos:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='bot_tenant_config'
--      AND column_name='messages';
--   -- constraint chave→texto presente:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.bot_tenant_config'::regclass
--      AND conname='bot_tenant_config_messages_is_object';
--   -- a função de validação rejeita valor não-string e não-objeto (sem tocar dados):
--   SELECT public.bot_tenant_config_messages_valid('{"ok":"texto"}'::jsonb) AS deve_ser_true,
--          public.bot_tenant_config_messages_valid('{"x":123}'::jsonb)     AS deve_ser_false,
--          public.bot_tenant_config_messages_valid('[]'::jsonb)            AS array_false;
--   -- linhas existentes receberam '{}' (nenhuma NULL):
--   SELECT count(*) AS total, count(*) FILTER (WHERE messages = '{}'::jsonb) AS vazias
--     FROM public.bot_tenant_config;
--   -- RLS continua habilitada:
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.bot_tenant_config'::regclass;
-- ============================================================================
