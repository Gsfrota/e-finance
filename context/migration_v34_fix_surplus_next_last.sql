-- =================================================================
-- V34: Fix apply_surplus_action — 'next' e 'last' agora iteram
--      até esgotar o excedente (antes processavam apenas 1 parcela)
-- Bug: pagamento de R$420 com parcelas de R$60 → apenas 2 baixas
--      em vez de 7. Excedente restante era descartado silenciosamente.
-- =================================================================

CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id UUID,
  p_surplus_amount  NUMERIC,
  p_action          TEXT   -- 'next' | 'last' | 'spread'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_src         RECORD;
  v_inst        RECORD;
  v_outstanding NUMERIC;
  v_remaining   NUMERIC := p_surplus_amount;
  v_ratio       NUMERIC;
BEGIN
  SELECT * INTO v_src FROM loan_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- 'next': aplica excedente nas parcelas pendentes em ordem crescente (da próxima em diante)
  IF p_action = 'next' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := v_inst.amount_total - COALESCE(v_inst.amount_paid, 0);
      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        v_ratio := (v_inst.amount_total - v_remaining) / NULLIF(v_inst.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - v_remaining,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;

  -- 'last': aplica excedente nas parcelas pendentes em ordem decrescente (da última em diante)
  ELSIF p_action = 'last' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number DESC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := v_inst.amount_total - COALESCE(v_inst.amount_paid, 0);
      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        v_ratio := (v_inst.amount_total - v_remaining) / NULLIF(v_inst.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - v_remaining,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;

  -- 'spread': distribui excedente proporcionalmente (sem alteração — já funcionava)
  ELSIF p_action = 'spread' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := v_inst.amount_total - COALESCE(v_inst.amount_paid, 0);
      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        v_ratio := (v_inst.amount_total - v_remaining) / NULLIF(v_inst.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - v_remaining,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;
END;
$$;
