-- =================================================================
-- V25: Fluxo de Falta (missed installment)
-- Aplicar via Supabase SQL Editor
-- =================================================================

ALTER TABLE public.loan_installments
  ADD COLUMN IF NOT EXISTS missed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deferred_from_id UUID
    REFERENCES public.loan_installments(id) ON DELETE SET NULL DEFAULT NULL;

-- RPC: registrar falta e tratar destino da parcela
CREATE OR REPLACE FUNCTION public.mark_installment_missed(
  p_installment_id UUID,
  p_defer_action   TEXT   -- 'postpone' | 'last' | 'new'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inst   RECORD;
  v_target RECORD;
  v_new_due DATE;
  v_new_num INTEGER;
  v_new_id  UUID;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- Marcar falta
  UPDATE loan_installments SET missed_at = NOW(), updated_at = NOW()
  WHERE id = p_installment_id;

  -- Registrar no histórico de renegociação
  INSERT INTO contract_renegotiations
    (investment_id, tenant_id, renegotiated_at, old_due_date, reason)
  VALUES (v_inst.investment_id, v_inst.tenant_id, NOW(), v_inst.due_date,
          'Falta registrada: ' || p_defer_action);

  IF p_defer_action = 'postpone' THEN
    UPDATE loan_installments
    SET due_date = (v_inst.due_date::DATE + INTERVAL '1 month')::DATE, updated_at = NOW()
    WHERE id = p_installment_id;
    RETURN jsonb_build_object('action', 'postponed');

  ELSIF p_defer_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_inst.investment_id
      AND id != p_installment_id
      AND status IN ('pending', 'late', 'partial')
    ORDER BY number DESC LIMIT 1;

    IF FOUND THEN
      UPDATE loan_installments
      SET amount_total     = amount_total     + v_inst.amount_total,
          amount_principal = amount_principal + v_inst.amount_principal,
          amount_interest  = amount_interest  + v_inst.amount_interest,
          deferred_from_id = p_installment_id,
          updated_at       = NOW()
      WHERE id = v_target.id;
      UPDATE loan_installments
      SET amount_total = 0, amount_principal = 0, amount_interest = 0,
          amount_paid = 0, status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = p_installment_id;
      RETURN jsonb_build_object('action', 'accumulated', 'target_number', v_target.number);
    ELSE
      p_defer_action := 'new';
    END IF;
  END IF;

  IF p_defer_action = 'new' THEN
    SELECT MAX(due_date) + INTERVAL '30 days' INTO v_new_due
    FROM loan_installments WHERE investment_id = v_inst.investment_id;
    SELECT COALESCE(MAX(number), 0) + 1 INTO v_new_num
    FROM loan_installments WHERE investment_id = v_inst.investment_id;

    INSERT INTO loan_installments
      (investment_id, tenant_id, number, due_date,
       amount_principal, amount_interest, amount_total, deferred_from_id)
    VALUES
      (v_inst.investment_id, v_inst.tenant_id, v_new_num, v_new_due,
       v_inst.amount_principal, v_inst.amount_interest, v_inst.amount_total, p_installment_id)
    RETURNING id INTO v_new_id;

    UPDATE investments SET total_installments = total_installments + 1
    WHERE id = v_inst.investment_id;

    UPDATE loan_installments
    SET amount_total = 0, amount_principal = 0, amount_interest = 0,
        amount_paid = 0, status = 'paid', paid_at = NOW(), updated_at = NOW()
    WHERE id = p_installment_id;

    RETURN jsonb_build_object('action', 'created', 'new_id', v_new_id, 'new_number', v_new_num);
  END IF;

  RETURN jsonb_build_object('action', p_defer_action);
END;
$$;
