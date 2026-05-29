-- ============================================================================
-- Migration — Bot: lembrete de mensalidade (PIX) + anúncios de novidades
-- ============================================================================
-- Data: 2026-05-29
-- Plano: ~/.claude/plans/o-bot-deve-ser-synchronous-stardust.md
--
-- ✅ APLICADA em 2026-05-29 no projeto enzgerrnlbiojkuzeilw via MCP
--    apply_migration (name: bot_subscription_reminder_and_announcements).
--    Schema real inspecionado antes (gate do guardião do banco), dry-run
--    transacional OK, e validação pós-apply confirmada.
--    Rollback: context/rollback_bot_subscription_announcements.sql
--
-- Mudanças:
--   1. tenants.subscription_due_day        — dia fixo de vencimento da mensalidade
--   2. bot_tenant_config.last_subscription_reminder_cycle — dedup mensal ('YYYY-MM')
--   3. announcements                       — conteúdo dos anúncios (sem deploy)
--   4. announcement_deliveries             — dedup por destinatário (1x por admin)
--
-- O bot acessa via service-role (bypassa RLS). As políticas abaixo restringem o
-- acesso de clientes (anon/authenticated) — billing/assinatura é tenant-only e
-- anúncios são geridos pelo dono da plataforma.
-- ============================================================================

BEGIN;

-- 1. Dia fixo de vencimento da mensalidade SaaS (1..28 para evitar bordas de mês).
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_due_day smallint
  CHECK (subscription_due_day IS NULL OR subscription_due_day BETWEEN 1 AND 28);

COMMENT ON COLUMN public.tenants.subscription_due_day IS
  'Dia do mês (1..28) de vencimento da mensalidade da plataforma. NULL = sem lembrete.';

-- 2. Carimbo do ciclo já notificado (dedup mensal do lembrete de mensalidade).
ALTER TABLE public.bot_tenant_config
  ADD COLUMN IF NOT EXISTS last_subscription_reminder_cycle text;

COMMENT ON COLUMN public.bot_tenant_config.last_subscription_reminder_cycle IS
  'Ciclo YYYY-MM do último lembrete de mensalidade enviado. Dedup mensal.';

-- 3. Anúncios de novas funcionalidades (gerenciáveis sem deploy).
CREATE TABLE IF NOT EXISTS public.announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL,
  target_roles text[] NOT NULL DEFAULT ARRAY['admin']
                 CHECK (target_roles <@ ARRAY['admin','investor','debtor']),
  active       boolean NOT NULL DEFAULT true,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Follow-up (migration announcements_optional_tenant_scope):
  -- NULL = global; preenchido = entregue só aos admins do tenant (piloto/rollout).
  tenant_id    uuid REFERENCES public.tenants(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.announcements IS
  'Anúncios proativos do bot (novas funcionalidades). Entregues por scheduler.';

-- Mantém updated_at fresco em edições. search_path fixo (hardening lint 0011).
CREATE OR REPLACE FUNCTION public.set_announcements_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON public.announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_announcements_updated_at();

-- 4. Entregas: garante 1 envio por destinatário (sobrevive a restart).
CREATE TABLE IF NOT EXISTS public.announcement_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, profile_id)
);

-- Sem índice extra em (announcement_id): o índice da UNIQUE
-- (announcement_id, profile_id) já cobre filtros pela coluna-líder.

-- RLS: habilitada e fechada para clientes; o bot usa service-role (bypass).
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_deliveries ENABLE ROW LEVEL SECURITY;

-- Leitura opcional dos anúncios ativos por usuários autenticados (admins veem no app).
DROP POLICY IF EXISTS announcements_read_active ON public.announcements;
CREATE POLICY announcements_read_active ON public.announcements
  FOR SELECT TO authenticated
  USING (active = true);

-- announcement_deliveries: sem política para clientes (somente service-role acessa).

COMMIT;

-- ============================================================================
-- Validação pós-aplicação (rodar manualmente após COMMIT, com aprovação):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='tenants' AND column_name='subscription_due_day';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='bot_tenant_config' AND column_name='last_subscription_reminder_cycle';
--   SELECT to_regclass('public.announcements'), to_regclass('public.announcement_deliveries');
-- ============================================================================
