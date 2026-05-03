-- migration_v44_eod_alert.sql
-- Aplicada em 2026-05-03 via MCP apply_migration (project enzgerrnlbiojkuzeilw)
--
-- Adiciona suporte ao alerta de fim de dia (EOD) por tenant:
--   - eod_alert_enabled       — opt-in (default false)
--   - eod_alert_time          — horário BRT 'HH:MM' (default '17:00')
--   - last_eod_alert_sent_at  — cooldown 23h espelhando morning_briefing
--   - eod_alert_promoted_at   — controle 1x da promoção da feature
-- Não destrutivo (IF NOT EXISTS), backward-compat (defaults).
-- Reverter: ALTER TABLE public.bot_tenant_config
--   DROP COLUMN IF EXISTS eod_alert_enabled,
--   DROP COLUMN IF EXISTS eod_alert_time,
--   DROP COLUMN IF EXISTS last_eod_alert_sent_at,
--   DROP COLUMN IF EXISTS eod_alert_promoted_at;

ALTER TABLE public.bot_tenant_config
  ADD COLUMN IF NOT EXISTS eod_alert_enabled       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eod_alert_time          text        NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS last_eod_alert_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS eod_alert_promoted_at   timestamptz;

COMMENT ON COLUMN public.bot_tenant_config.eod_alert_enabled
  IS 'Se true, bot avisa o admin no horário eod_alert_time sobre parcelas vencendo hoje sem baixa.';
COMMENT ON COLUMN public.bot_tenant_config.eod_alert_time
  IS 'Horário BRT (HH:MM) do alerta de fim de dia.';
COMMENT ON COLUMN public.bot_tenant_config.eod_alert_promoted_at
  IS 'Quando o bot enviou a promoção da feature pela 1ª vez (NULL = nunca promoveu).';
