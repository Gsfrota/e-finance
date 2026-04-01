-- =================================================================
-- V38: Reversão de Falta (revert_installment_missed)
-- Aplicar via Supabase SQL Editor
-- =================================================================

-- 1. Adicionar coluna metadata em contract_renegotiations para guardar
--    valores originais da parcela antes de ser zerada pelo missed flow
ALTER TABLE public.contract_renegotiations
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- 2. Atualizar mark_installment_missed para persistir metadados de reversão
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
  v_target_id UUID;
  v_meta   JSONB;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- Marcar falta
  UPDATE loan_installments SET missed_at = NOW(), updated_at = NOW()
  WHERE id = p_installment_id;

  IF p_defer_action = 'postpone' THEN
    UPDATE loan_installments
    SET due_date = (v_inst.due_date::DATE + INTERVAL '1 month')::DATE, updated_at = NOW()
    WHERE id = p_installment_id;

    INSERT INTO contract_renegotiations
      (investment_id, tenant_id, renegotiated_at, old_due_date, reason, metadata)
    VALUES (v_inst.investment_id, v_inst.tenant_id, NOW(), v_inst.due_date,
            'Falta registrada: postpone',
            jsonb_build_object(
              'defer_action', 'postpone',
              'original_due_date', v_inst.due_date::TEXT,
              'target_id', NULL
            ));
    RETURN jsonb_build_object('action', 'postponed');

  ELSIF p_defer_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_inst.investment_id
      AND id != p_installment_id
      AND status IN ('pending', 'late', 'partial')
    ORDER BY number DESC LIMIT 1;

    IF FOUND THEN
      v_target_id := v_target.id;
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

      v_meta := jsonb_build_object(
        'defer_action', 'last',
        'original_total', v_inst.amount_total,
        'original_principal', v_inst.amount_principal,
        'original_interest', v_inst.amount_interest,
        'target_id', v_target_id::TEXT,
        'target_number', v_target.number
      );
      INSERT INTO contract_renegotiations
        (investment_id, tenant_id, renegotiated_at, old_due_date, reason, metadata)
      VALUES (v_inst.investment_id, v_inst.tenant_id, NOW(), v_inst.due_date,
              'Falta registrada: last', v_meta);

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

    v_meta := jsonb_build_object(
      'defer_action', 'new',
      'original_total', v_inst.amount_total,
      'original_principal', v_inst.amount_principal,
      'original_interest', v_inst.amount_interest,
      'target_id', v_new_id::TEXT,
      'target_number', v_new_num
    );
    INSERT INTO contract_renegotiations
      (investment_id, tenant_id, renegotiated_at, old_due_date, reason, metadata)
    VALUES (v_inst.investment_id, v_inst.tenant_id, NOW(), v_inst.due_date,
            'Falta registrada: new', v_meta);

    RETURN jsonb_build_object('action', 'created', 'new_id', v_new_id, 'new_number', v_new_num);
  END IF;

  RETURN jsonb_build_object('action', p_defer_action);
END;
$$;

-- 3. Criar RPC de reversão de falta
CREATE OR REPLACE FUNCTION public.revert_installment_missed(
  p_installment_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inst     RECORD;
  v_target   RECORD;
  v_renegot  RECORD;
  v_meta     JSONB;
  v_defer_action TEXT;
  v_orig_total     NUMERIC;
  v_orig_principal NUMERIC;
  v_orig_interest  NUMERIC;
  v_target_id UUID;
  v_orig_due DATE;
BEGIN
  -- Travar e validar parcela original
  SELECT * INTO v_inst FROM loan_installments
  WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF v_inst.missed_at IS NULL THEN
    RAISE EXCEPTION 'Esta parcela não possui falta registrada';
  END IF;

  -- Janela de 72h (BR-PAG-020)
  IF (NOW() - v_inst.missed_at) > INTERVAL '72 hours' THEN
    RAISE EXCEPTION 'Reversão não permitida após 72 horas da falta registrada';
  END IF;

  -- Buscar renegociação com metadados para recuperar valores originais
  SELECT * INTO v_renegot FROM contract_renegotiations
  WHERE investment_id = v_inst.investment_id
    AND reason LIKE 'Falta registrada:%'
    AND metadata IS NOT NULL
    AND renegotiated_at >= v_inst.missed_at - INTERVAL '5 seconds'
  ORDER BY renegotiated_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_renegot.metadata IS NULL THEN
    RAISE EXCEPTION 'Dados de reversão não disponíveis para esta falta. Esta falta foi registrada antes da versão v38 — contate o suporte para reversão manual';
  END IF;

  v_meta         := v_renegot.metadata;
  v_defer_action := v_meta->>'defer_action';
  v_orig_total     := (v_meta->>'original_total')::NUMERIC;
  v_orig_principal := (v_meta->>'original_principal')::NUMERIC;
  v_orig_interest  := (v_meta->>'original_interest')::NUMERIC;

  -- ── Ação: postpone ────────────────────────────────────────────────────────
  IF v_defer_action = 'postpone' THEN
    v_orig_due := (v_meta->>'original_due_date')::DATE;
    UPDATE loan_installments
    SET due_date = v_orig_due, missed_at = NULL, updated_at = NOW()
    WHERE id = p_installment_id;

    DELETE FROM contract_renegotiations WHERE id = v_renegot.id;

    RETURN jsonb_build_object(
      'action', 'reverted',
      'defer_action', 'postpone',
      'installment_number', v_inst.number
    );
  END IF;

  -- ── Ações: last / new — buscar parcela destino ─────────────────────────────
  v_target_id := (v_meta->>'target_id')::UUID;

  SELECT * INTO v_target FROM loan_installments
  WHERE id = v_target_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcela destino não encontrada (id: %)', v_target_id;
  END IF;

  -- Guard: parcela destino já foi paga pelo devedor
  IF v_target.status = 'paid' AND v_target.amount_paid > 0.009 THEN
    RAISE EXCEPTION 'A parcela destino (#%) já foi paga — reversão não permitida', v_target.number;
  END IF;

  -- ── Ação: new — remover parcela criada ────────────────────────────────────
  IF v_defer_action = 'new' THEN
    DELETE FROM loan_installments WHERE id = v_target_id;
    UPDATE investments SET total_installments = total_installments - 1
    WHERE id = v_inst.investment_id;
  END IF;

  -- ── Ação: last — subtrair valor acumulado da parcela destino ──────────────
  IF v_defer_action = 'last' THEN
    -- Guard: subtrair não pode deixar valor negativo
    IF v_target.amount_total - v_orig_total < -0.009 THEN
      RAISE EXCEPTION 'Parcela destino foi modificada após o deferimento — reversão não permitida';
    END IF;
    UPDATE loan_installments
    SET amount_total     = GREATEST(0, amount_total     - v_orig_total),
        amount_principal = GREATEST(0, amount_principal - v_orig_principal),
        amount_interest  = GREATEST(0, amount_interest  - v_orig_interest),
        deferred_from_id = NULL,
        updated_at       = NOW()
    WHERE id = v_target_id;
  END IF;

  -- ── Restaurar parcela original ────────────────────────────────────────────
  UPDATE loan_installments
  SET amount_total     = v_orig_total,
      amount_principal = v_orig_principal,
      amount_interest  = v_orig_interest,
      amount_paid      = 0,
      status           = 'pending',
      paid_at          = NULL,
      missed_at        = NULL,
      updated_at       = NOW()
  WHERE id = p_installment_id;

  -- Limpar registro de renegociação
  DELETE FROM contract_renegotiations WHERE id = v_renegot.id;

  RETURN jsonb_build_object(
    'action', 'reverted',
    'defer_action', v_defer_action,
    'installment_number', v_inst.number,
    'restored_total', v_orig_total
  );
END;
$$;
