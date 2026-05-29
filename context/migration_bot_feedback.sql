-- ============================================================================
-- Migration FB-001 — Tabela de feedback/reclamações do bot (suporte)
-- ============================================================================
-- Data: 2026-05-29
-- Story: docs/stories/FB-001-bot-feedback-suporte.story.md
--
-- ⚠️ Gate do guardião do banco: schema real inspecionado antes
--    (profiles.id/tenants.id = uuid; tabelas de dados do bot usam RLS on + 0
--    policies = só service-role). Dry-run transacional OK. Aprovação explícita
--    do usuário antes do apply. Validação após. Rollback:
--    context/rollback_bot_feedback.sql
--
-- Registra reclamações/problemas relatados pelo cliente que o bot encaminha
-- ao suporte (85991318582). FKs SET NULL: o feedback é preservado mesmo que
-- tenant/profile sejam removidos (registro de suporte/auditoria).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.bot_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','telegram')),
  channel_user_id text,
  sender_name     text,
  sender_phone    text,
  message_text    text NOT NULL,
  forwarded_to    text,
  forwarded_ok    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bot_feedback IS
  'Reclamações/feedback de clientes capturados pelo bot e encaminhados ao suporte. Acesso só por service-role.';

-- Padrão de consulta futuro: inbox por status (mais recentes primeiro) e filtro por tenant.
CREATE INDEX IF NOT EXISTS idx_bot_feedback_status_created
  ON public.bot_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_feedback_tenant
  ON public.bot_feedback (tenant_id);

-- updated_at automático (status muda open→handled). search_path fixo (lint 0011).
CREATE OR REPLACE FUNCTION public.set_bot_feedback_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_feedback_updated_at ON public.bot_feedback;
CREATE TRIGGER trg_bot_feedback_updated_at
  BEFORE UPDATE ON public.bot_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_bot_feedback_updated_at();

-- RLS habilitada sem policies: somente service-role (bot) acessa.
-- Mesmo padrão de bot_messages / bot_sessions / bot_turn_traces.
ALTER TABLE public.bot_feedback ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- Validação pós-apply (com aprovação):
--   SELECT to_regclass('public.bot_feedback');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.bot_feedback'::regclass;
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.bot_feedback'::regclass;
-- ============================================================================
