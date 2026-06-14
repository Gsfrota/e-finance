-- ============================================================================
-- Rollback I18N-001 — remove coluna `messages` de bot_tenant_config
-- ============================================================================
-- Reverte context/migration_bot_messages_i18n.sql.
-- Seguro: a coluna é aditiva e o código tem defaults embutidos (t(key)),
-- então remover o override não quebra o bot — só volta a usar os defaults.
-- ⚠️ Destrutivo p/ overrides: descarta qualquer texto custom já gravado por
--    tenant. Exportar antes se houver dados:
--    SELECT tenant_id, messages FROM public.bot_tenant_config WHERE messages <> '{}'::jsonb;
-- ============================================================================

BEGIN;

ALTER TABLE public.bot_tenant_config
  DROP CONSTRAINT IF EXISTS bot_tenant_config_messages_is_object;

ALTER TABLE public.bot_tenant_config
  DROP COLUMN IF EXISTS messages;

DROP FUNCTION IF EXISTS public.bot_tenant_config_messages_valid(jsonb);

COMMIT;

-- Validação pós-rollback:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='bot_tenant_config'
--      AND column_name='messages';  -- deve retornar 0 linhas
