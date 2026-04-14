-- ============================================================
-- Migration v42: Tabela de auditoria de ações do cliente
-- BR-SYS-008
-- Data: 2026-04-14
-- ============================================================
-- Cria a tabela tenant_events para rastrear toda ação de
-- cliente com efeito colateral (auth, contratos, pagamentos,
-- overrides administrativos). Non-blocking insert via
-- services/eventLog.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL,
  event_category TEXT        NOT NULL,  -- auth | contract | payment | installment_admin
  event_type     TEXT        NOT NULL,  -- login_success | contract_created | pay_installment...
  entity_type    TEXT,                  -- investment | loan_installment | profile | company
  entity_id      TEXT,                  -- UUID ou INT (como string) da entidade afetada
  metadata       JSONB       NOT NULL DEFAULT '{}',  -- { before:{}, after:{}, context:{} }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consulta eficiente por tenant + período, por usuário e por entidade
CREATE INDEX idx_tenant_events_tenant_time
  ON public.tenant_events (tenant_id, created_at DESC);

CREATE INDEX idx_tenant_events_user
  ON public.tenant_events (user_id, created_at DESC);

CREATE INDEX idx_tenant_events_entity
  ON public.tenant_events (entity_type, entity_id)
  WHERE entity_type IS NOT NULL;

CREATE INDEX idx_tenant_events_category
  ON public.tenant_events (event_category, event_type);

-- RLS: cada tenant vê apenas seus próprios eventos
-- Usa get_tenant_id_safe() para suportar auth_user_id E profiles.id = auth.uid()
ALTER TABLE public.tenant_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_events_tenant_isolation"
  ON public.tenant_events
  FOR ALL
  USING (tenant_id = get_tenant_id_safe());

-- Comentários descritivos
COMMENT ON TABLE  public.tenant_events              IS 'Log de auditoria de ações do cliente. BR-SYS-008.';
COMMENT ON COLUMN public.tenant_events.event_category IS 'Categoria: auth | contract | payment | installment_admin';
COMMENT ON COLUMN public.tenant_events.event_type     IS 'Tipo específico da ação (ex: login_success, contract_created)';
COMMENT ON COLUMN public.tenant_events.metadata       IS 'Snapshot: { before:{}, after:{}, context:{user_agent, method} }';
