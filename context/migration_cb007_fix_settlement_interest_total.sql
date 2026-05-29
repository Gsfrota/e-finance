-- ============================================================================
-- CB-007-A: Fix pay_bullet_interest_only — interest_payments_total no settlement
--
-- Problema: caminho de settlement não atualizava interest_payments_total na
-- parcela. O campo ficava NULL/0 mesmo após quitação, quebrando totalizadores
-- de juros recebidos por parcela.
--
-- Solução: adicionar interest_payments_total ao UPDATE do settlement path.
-- Assinatura do RPC não muda — apenas o corpo. DROP + CREATE idêntico ao
-- CB-005/CB-006 com a correção aplicada.
-- ============================================================================

-- Drop overload para recriar com mesmo nome/assinatura
DROP FUNCTION IF EXISTS public.pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.pay_bullet_interest_only(
  p_installment_id UUID,
  p_paid_at        TIMESTAMPTZ DEFAULT NOW(),
  p_payment_method TEXT        DEFAULT 'PIX',
  p_amount_paid    NUMERIC     DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inst            loan_installments%ROWTYPE;
  v_inv             investments%ROWTYPE;
  v_interest_due    NUMERIC;
  v_remaining       NUMERIC;
  v_effective_amt   NUMERIC;
  v_is_settlement   BOOLEAN;
  v_next_id         UUID;
  v_tx_id           UUID;
  v_actor_id        UUID;
  v_correlation_id  UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_inst FROM public.loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada: %', p_installment_id; END IF;

  SELECT * INTO v_inv FROM public.investments WHERE id = v_inst.investment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado: %', v_inst.investment_id; END IF;

  IF v_inv.calculation_mode <> 'interest_only' THEN
    RAISE EXCEPTION 'Esta operação é exclusiva para contratos de juros simples.';
  END IF;
  IF v_inst.status = 'paid' THEN
    RAISE EXCEPTION 'Esta parcela já está quitada.';
  END IF;

  v_interest_due := GREATEST(0, v_inst.amount_interest - COALESCE(v_inst.interest_payments_total, 0));
  IF v_interest_due <= 0.005 THEN
    RAISE EXCEPTION 'Juros já quitados nesta parcela.';
  END IF;

  v_remaining     := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);
  v_effective_amt := COALESCE(p_amount_paid, v_interest_due);
  v_is_settlement := v_effective_amt >= (v_remaining - 0.005);

  v_actor_id := auth.uid();

  -- ── SETTLEMENT ─────────────────────────────────────────────────────────────
  IF v_is_settlement THEN

    UPDATE public.loan_installments SET
      amount_paid             = v_effective_amt,
      interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_due,  -- CB-007: fix
      status                  = 'paid',
      paid_at                 = p_paid_at,
      payment_method          = p_payment_method,
      updated_at              = NOW()
    WHERE id = p_installment_id;

    UPDATE public.investments SET
      remaining_balance = 0,
      status            = 'completed',
      updated_at        = NOW()
    WHERE id = v_inv.id;

    INSERT INTO public.payment_transactions (
      tenant_id, investment_id, installment_id,
      transaction_type, amount,
      principal_portion, interest_portion,
      payment_method, created_at
    ) VALUES (
      v_inv.tenant_id, v_inv.id, p_installment_id,
      'bullet_settlement', v_effective_amt,
      v_remaining, v_interest_due,
      p_payment_method, p_paid_at
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.audit_events (
      tenant_id, investment_id, installment_id, payment_id,
      event_type, source, actor_user_id,
      company_id, correlation_id,
      before, after, value_breakdown,
      created_at
    ) VALUES (
      v_inv.tenant_id, v_inv.id, p_installment_id, v_tx_id,
      'bullet_settled', 'rpc', v_actor_id,
      v_inv.company_id, v_correlation_id,
      jsonb_build_object(
        'remaining_balance', v_remaining,
        'investment_status', 'active',
        'installment_status', v_inst.status
      ),
      jsonb_build_object(
        'remaining_balance', 0,
        'investment_status', 'completed',
        'installment_status', 'paid'
      ),
      jsonb_build_object(
        'total_paid',   v_effective_amt,
        'principal',    v_remaining,
        'interest',     v_interest_due
      ),
      p_paid_at
    );

    RETURN json_build_object(
      'interest_paid',       v_interest_due,
      'principal_paid',      v_remaining,
      'new_balance',         0,
      'next_installment_id', NULL,
      'contract_closed',     TRUE
    );

  -- ── ROLAGEM DE JUROS ───────────────────────────────────────────────────────
  ELSE

    UPDATE public.loan_installments SET
      amount_paid             = COALESCE(amount_paid, 0) + v_interest_due,
      interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_due,
      status                  = 'paid',
      paid_at                 = p_paid_at,
      payment_method          = p_payment_method,
      updated_at              = NOW()
    WHERE id = p_installment_id;

    INSERT INTO public.payment_transactions (
      tenant_id, investment_id, installment_id,
      transaction_type, amount,
      principal_portion, interest_portion,
      payment_method, created_at
    ) VALUES (
      v_inv.tenant_id, v_inv.id, p_installment_id,
      'bullet_interest', v_interest_due,
      0, v_interest_due,
      p_payment_method, p_paid_at
    ) RETURNING id INTO v_tx_id;

    INSERT INTO public.audit_events (
      tenant_id, investment_id, installment_id, payment_id,
      event_type, source, actor_user_id,
      company_id, correlation_id,
      before, after, value_breakdown,
      created_at
    ) VALUES (
      v_inv.tenant_id, v_inv.id, p_installment_id, v_tx_id,
      'bullet_rollover', 'rpc', v_actor_id,
      v_inv.company_id, v_correlation_id,
      jsonb_build_object(
        'remaining_balance',   v_remaining,
        'installment_status',  v_inst.status,
        'interest_paid_total', COALESCE(v_inst.interest_payments_total, 0)
      ),
      jsonb_build_object(
        'remaining_balance',   v_remaining,
        'installment_status',  'paid',
        'interest_paid_total', COALESCE(v_inst.interest_payments_total, 0) + v_interest_due
      ),
      jsonb_build_object(
        'interest', v_interest_due,
        'principal', 0
      ),
      p_paid_at
    );

    v_next_id := public.generate_next_bullet_installment(v_inv.id);

    RETURN json_build_object(
      'interest_paid',       v_interest_due,
      'new_balance',         v_remaining,
      'next_installment_id', v_next_id,
      'contract_closed',     FALSE
    );

  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT, NUMERIC)
  TO authenticated, service_role;

-- Verificar em BEGIN/ROLLBACK antes do apply:
-- BEGIN;
-- SELECT pay_bullet_interest_only('<installment_id_bullet_pago>'::uuid, now(), 'PIX', 999);
-- SELECT interest_payments_total FROM loan_installments WHERE id = '<id>';
-- ROLLBACK;
