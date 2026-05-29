-- ============================================================================
-- CB-005 + CB-006: Fix pay_bullet_interest_only
--
-- CB-005: Adicionar lógica de settlement (remaining_balance=0, status=completed)
--         quando p_amount_paid >= remaining_balance.
-- CB-006: Gravar transaction_type correto (bullet_interest / bullet_settlement)
--         em payment_transactions e eventos em audit_events — dentro da mesma
--         transação (elimina dependência do logPaymentTransaction client-side).
--
-- Estratégia:
--   • DROP + CREATE (adição de parâmetro opcional p_amount_paid NUMERIC DEFAULT NULL)
--   • NULL = modo juros-only (comportamento anterior, retrocompatível)
--   • p_amount_paid >= remaining_balance = settlement
-- ============================================================================

-- Drop overload antigo para permitir assinatura nova
DROP FUNCTION IF EXISTS public.pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.pay_bullet_interest_only(
  p_installment_id UUID,
  p_paid_at        TIMESTAMPTZ DEFAULT NOW(),
  p_payment_method TEXT        DEFAULT 'PIX',
  p_amount_paid    NUMERIC     DEFAULT NULL   -- NULL = pagar só juros; >= remaining_balance = settlement
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
  -- Lock parcela e contrato (evita race condition)
  SELECT * INTO v_inst FROM public.loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada: %', p_installment_id; END IF;

  SELECT * INTO v_inv FROM public.investments WHERE id = v_inst.investment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado: %', v_inst.investment_id; END IF;

  -- Validações
  IF v_inv.calculation_mode <> 'interest_only' THEN
    RAISE EXCEPTION 'Esta operação é exclusiva para contratos de juros simples.';
  END IF;
  IF v_inst.status = 'paid' THEN
    RAISE EXCEPTION 'Esta parcela já está quitada.';
  END IF;

  -- Calcular juros pendentes
  v_interest_due := GREATEST(0, v_inst.amount_interest - COALESCE(v_inst.interest_payments_total, 0));
  IF v_interest_due <= 0.005 THEN
    RAISE EXCEPTION 'Juros já quitados nesta parcela.';
  END IF;

  -- Saldo devedor atual
  v_remaining := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);

  -- Valor efetivo e decisão settlement vs. rolagem
  v_effective_amt  := COALESCE(p_amount_paid, v_interest_due);
  v_is_settlement  := v_effective_amt >= (v_remaining - 0.005);

  -- Actor: auth.uid() retorna UUID do usuário autenticado; NULL para cron/service_role
  v_actor_id := auth.uid();

  -- ── CB-005: SETTLEMENT ─────────────────────────────────────────────────────
  IF v_is_settlement THEN

    -- 1. Marcar parcela como paga
    UPDATE public.loan_installments SET
      amount_paid    = v_effective_amt,
      status         = 'paid',
      paid_at        = p_paid_at,
      payment_method = p_payment_method,
      updated_at     = NOW()
    WHERE id = p_installment_id;

    -- 2. Fechar contrato
    UPDATE public.investments SET
      remaining_balance = 0,
      status            = 'completed',
      updated_at        = NOW()
    WHERE id = v_inv.id;

    -- 3. CB-006: payment_transactions com tipo bullet_settlement
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

    -- 4. CB-006: audit_events bullet_settled
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

  -- ── CB-006: ROLAGEM DE JUROS (comportamento anterior mantido) ─────────────
  ELSE

    -- 1. Marcar parcela como paga (só pelos juros — principal permanece)
    UPDATE public.loan_installments SET
      amount_paid             = COALESCE(amount_paid, 0) + v_interest_due,
      interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_due,
      status                  = 'paid',
      paid_at                 = p_paid_at,
      payment_method          = p_payment_method,
      updated_at              = NOW()
    WHERE id = p_installment_id;

    -- remaining_balance NÃO muda: o principal continua em aberto

    -- 2. CB-006: payment_transactions com tipo bullet_interest
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

    -- 3. CB-006: audit_events bullet_rollover
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

    -- 4. Gerar próxima parcela (juros sobre o mesmo saldo devedor)
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

-- Verificação (rodar em BEGIN/ROLLBACK antes do apply definitivo)
-- SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'pay_bullet_interest_only';
