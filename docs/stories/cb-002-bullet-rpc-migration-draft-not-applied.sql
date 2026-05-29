-- CB-002 — DRAFT seguro de migration/RPC Bullet (NÃO APLICADO)
-- Data: 2026-05-29
-- Status: rascunho documental; não colocar em supabase/migrations sem revisão Claude/MCP + PO/jurídico.
-- Guardião Supabase: Claude Code/MCP. Hermes não executou Supabase para produzir este arquivo.
-- Evidências base: docs/stories/CB-002-bullet-flow-regularization.story.md
--                 docs/stories/cb-002-claude-mcp-validation-2026-05-28.md
-- Objetivo futuro: suportar ações Bullet explícitas: full_settlement, interest_rollover,
--                  partial_payment, capitalize_default, apply_break_fee.

BEGIN;

-- 1) Campos de configuração por contrato Bullet.
--    Confirmado por Claude/MCP: default_after_days/grace_days e break_fee_* não existiam no schema real.
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS default_after_days integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS break_fee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_fee_percent numeric(8,4),
  ADD COLUMN IF NOT EXISTS break_fee_fixed numeric(14,2);

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investments_default_after_days_positive'
  ) THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_default_after_days_positive
      CHECK (default_after_days > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investments_break_fee_non_negative'
  ) THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_break_fee_non_negative
      CHECK (
        (break_fee_percent IS NULL OR break_fee_percent >= 0)
        AND (break_fee_fixed IS NULL OR break_fee_fixed >= 0)
      );
  END IF;
END
$do$;

-- 2) Campos auxiliares por parcela/ciclo.
--    Manter defaulted de parcela como derivado até validar enum/check real de loan_installments.status.
ALTER TABLE public.loan_installments
  ADD COLUMN IF NOT EXISTS bullet_cycle_action text,
  ADD COLUMN IF NOT EXISTS capitalized_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rollover_from_id uuid REFERENCES public.loan_installments(id),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loan_installments_bullet_cycle_action_check'
  ) THEN
    ALTER TABLE public.loan_installments
      ADD CONSTRAINT loan_installments_bullet_cycle_action_check
      CHECK (
        bullet_cycle_action IS NULL OR bullet_cycle_action IN (
          'full_settlement',
          'interest_rollover',
          'partial_payment',
          'capitalize_default',
          'apply_break_fee'
        )
      );
  END IF;
END
$do$;

-- 3) Auditoria transacional.
--    TODO Claude/MCP antes de aplicar: inspecionar constraint real de payment_transactions.transaction_type.
--    Opções:
--    a) estender constraint para aceitar bullet_*; ou
--    b) usar transaction_type existente com metadata obrigatória {"bullet_action": "..."}.
--    Decisão recomendada pela CB-002: auditoria dentro da própria RPC; falha de auditoria bloqueia baixa.

-- 4) RPC futura — esboço de assinatura, não implementar/aplicar sem nova revisão.
-- CREATE OR REPLACE FUNCTION public.process_bullet_cycle_payment(
--   p_installment_id uuid,
--   p_amount numeric,
--   p_action text,
--   p_paid_at timestamptz DEFAULT now(),
--   p_payment_method text DEFAULT 'manual',
--   p_notes text DEFAULT NULL
-- ) RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--   v_installment public.loan_installments%ROWTYPE;
--   v_investment public.investments%ROWTYPE;
--   v_total_due numeric(14,2);
--   v_interest_due numeric(14,2);
--   v_break_fee_due numeric(14,2) := 0;
-- BEGIN
--   -- Lock obrigatório para idempotência/concorrência:
--   -- SELECT * INTO v_installment FROM public.loan_installments WHERE id = p_installment_id FOR UPDATE;
--   -- SELECT * INTO v_investment FROM public.investments WHERE id = v_installment.investment_id FOR UPDATE;
--   -- Validar calculation_mode='interest_only', status aberto e p_action permitido.
--   -- Imputação: encargos/taxa quebra vencida -> juros -> principal.
--   -- full_settlement: zera remaining_balance, paid, completed, sem nova parcela.
--   -- interest_rollover: quita juros, mantém principal, gera próxima cobrança.
--   -- partial_payment: registra parcial e saldo aberto.
--   -- capitalize_default: após default_after_days, capitaliza total vencido se permitido.
--   -- apply_break_fee: só após daysLate >= default_after_days e break_fee_enabled=true.
--   -- Inserir payment_transactions na mesma transação; se falhar, RAISE.
--   RAISE EXCEPTION 'CB-002 draft only: revisar/implementar antes de aplicar';
-- END;
-- $$;

-- Segurança: este arquivo é draft documental. Se alguém executar por engano como script, nada deve persistir.
ROLLBACK;
