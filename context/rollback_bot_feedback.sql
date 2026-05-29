-- ============================================================================
-- Rollback FB-001 — remove a tabela de feedback do bot
-- ============================================================================
-- Reverte context/migration_bot_feedback.sql
-- Baseline: bot_feedback NÃO existia antes (29/05/2026, projeto enzgerrnlbiojkuzeilw).
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.bot_feedback;
DROP FUNCTION IF EXISTS public.set_bot_feedback_updated_at();

COMMIT;
