-- ============================================================================
-- Rollback — Bot: lembrete de mensalidade (PIX) + anúncios de novidades
-- ============================================================================
-- Reverte context/migration_bot_subscription_announcements.sql
-- Baseline confirmado (29/05/2026, projeto enzgerrnlbiojkuzeilw):
--   - tenants SEM subscription_due_day
--   - bot_tenant_config SEM last_subscription_reminder_cycle
--   - announcements / announcement_deliveries NÃO existiam
-- Seguro rodar para restaurar exatamente o estado anterior.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.announcement_deliveries;
DROP TABLE IF EXISTS public.announcements;
DROP FUNCTION IF EXISTS public.set_announcements_updated_at();

ALTER TABLE public.bot_tenant_config
  DROP COLUMN IF EXISTS last_subscription_reminder_cycle;

ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS subscription_due_day;

COMMIT;
