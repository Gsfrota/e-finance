-- =================================================================
-- V26: Corrigir apply_surplus_action — marcar parcela como 'paid'
--      quando excedente cobre totalmente o valor pendente
-- =================================================================

CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id UUID,
  p_surplus_amount  NUMERIC,
  p_action          TEXT   -- 'next' | 'last' | 'spread'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_src       RECORD;
  v_target    RECORD;
  v_outstanding NUMERIC;
  v_remaining   NUMERIC := p_surplus_amount;
  v_inst      RECORD;
BEGIN
  SELECT * INTO v_src FROM loan_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  IF p_action = 'next' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id
    ORDER BY number ASC LIMIT 1;

    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid, 0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_total  = COALESCE(amount_paid, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_target.id;
      ELSE
        UPDATE loan_installments
        SET amount_total = amount_total - p_surplus_amount,
            updated_at   = NOW()
        WHERE id = v_target.id;
      END IF;
    END IF;

  ELSIF p_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id
    ORDER BY number DESC LIMIT 1;

    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid, 0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_total  = COALESCE(amount_paid, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_target.id;
      ELSE
        UPDATE loan_installments
        SET amount_total = amount_total - p_surplus_amount,
            updated_at   = NOW()
        WHERE id = v_target.id;
      END IF;
    END IF;

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
        SET amount_total  = COALESCE(amount_paid, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        UPDATE loan_installments
        SET amount_total = amount_total - v_remaining,
            updated_at   = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;
END;
$$;
