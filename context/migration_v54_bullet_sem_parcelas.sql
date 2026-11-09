-- ============================================================================
-- Migration v54 — bullet não tem parcelas (BR-CNT-013, story BUL-001)
-- ============================================================================
-- RCA 2026-11-08: cliente via contrato bullet "com parcelas". Causas no banco:
--   1. create_legacy_investment gerava N parcelas + linha só de principal
--      ('separate') e não gravava remaining_balance — bullet de prazo fixo.
--   2. mark_installment_missed / apply_remainder_action / defer_remaining_to_last
--      aceitavam linha de bullet e inseriam linhas extras.
-- Decisões do usuário (2026-11-08):
--   - legado bullet: p_paid_count ciclos pagos (histórico) + 1 ciclo aberto;
--   - falta/adiamento: bloqueados no bullet (atraso segue regra de rolagem);
--   - sanear os 6 contratos afetados nesta mesma migration.
-- CREATE OR REPLACE preserva os GRANTs de v45.
-- ============================================================================

-- (apply_migration já roda em transação)

-- ── 1. create_legacy_investment ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_legacy_investment(p_tenant_id uuid, p_user_id uuid, p_payer_id uuid, p_asset_name text, p_amount_invested numeric, p_source_capital numeric DEFAULT 0, p_source_profit numeric DEFAULT 0, p_current_value numeric DEFAULT 0, p_interest_rate numeric DEFAULT 0, p_installment_value numeric DEFAULT 0, p_total_installments integer DEFAULT 1, p_frequency text DEFAULT 'monthly'::text, p_first_due_date date DEFAULT CURRENT_DATE, p_paid_count integer DEFAULT 0, p_calculation_mode text DEFAULT 'manual'::text, p_original_code text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_skip_saturday boolean DEFAULT false, p_skip_sunday boolean DEFAULT false, p_weekday integer DEFAULT NULL::integer, p_custom_dates date[] DEFAULT NULL::date[], p_bullet_principal_mode text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_investment_id BIGINT;
  v_amount_principal NUMERIC;
  v_amount_interest NUMERIC;
  v_installment_value_rounded NUMERIC;
  v_due_date DATE;
  v_target_company_id UUID;
  v_is_bullet BOOLEAN;
  v_interest_per_period NUMERIC;
  v_bd_count INTEGER;
  v_candidate DATE;
  v_rows INTEGER;
  i INTEGER;
  v_total_base NUMERIC; v_p NUMERIC; v_t NUMERIC;
BEGIN
  -- Tenant validation
  IF auth.uid() IS NOT NULL
     AND public.get_tenant_id_safe() IS NOT NULL
     AND p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant invalido para o usuario autenticado.';
  END IF;

  v_target_company_id := public.resolve_company_id_for_tenant(
    p_tenant_id,
    p_company_id,
    p_user_id,
    p_payer_id
  );

  v_is_bullet := (p_calculation_mode = 'interest_only');
  v_installment_value_rounded := ROUND(p_installment_value::numeric, 2);

  -- v54: bullet não tem prazo — p_total_installments e p_bullet_principal_mode
  -- são ignorados; grava os ciclos de juros já pagos + 1 ciclo aberto.
  IF v_is_bullet THEN
    IF COALESCE(p_paid_count, 0) < 0 THEN
      RAISE EXCEPTION 'Ciclos de juros já pagos não pode ser negativo (recebido: %).', p_paid_count;
    END IF;
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;
    v_rows := COALESCE(p_paid_count, 0) + 1;
    IF p_frequency = 'freelancer' AND COALESCE(array_length(p_custom_dates, 1), 0) < v_rows THEN
      RAISE EXCEPTION 'Frequência freelancer exige % data(s) de vencimento (recebidas: %).',
        v_rows, COALESCE(array_length(p_custom_dates, 1), 0);
    END IF;
  ELSE
    v_rows := p_total_installments;
  END IF;

  INSERT INTO public.investments (
    tenant_id,
    company_id,
    user_id,
    payer_id,
    asset_name,
    amount_invested,
    current_value,
    interest_rate,
    installment_value,
    total_installments,
    frequency,
    due_day,
    weekday,
    start_date,
    calculation_mode,
    source_capital,
    source_profit,
    original_contract_code,
    bullet_principal_mode,
    remaining_balance
  )
  VALUES (
    p_tenant_id,
    v_target_company_id,
    p_user_id,
    p_payer_id,
    p_asset_name,
    p_amount_invested,
    CASE WHEN v_is_bullet THEN p_amount_invested ELSE p_current_value END,
    p_interest_rate,
    v_installment_value_rounded,
    CASE WHEN v_is_bullet THEN NULL ELSE p_total_installments END,
    p_frequency,
    CASE
      WHEN p_frequency = 'monthly' THEN EXTRACT(DAY FROM p_first_due_date)::INTEGER
      ELSE NULL
    END,
    p_weekday,
    p_first_due_date,
    p_calculation_mode,
    p_source_capital,
    p_source_profit,
    p_original_code,
    CASE WHEN v_is_bullet THEN NULL ELSE p_bullet_principal_mode END,
    CASE WHEN v_is_bullet THEN p_amount_invested ELSE NULL END
  )
  RETURNING id INTO v_investment_id;

  -- Calculate per-installment amounts for standard mode
  IF NOT v_is_bullet THEN
    v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
    -- v48: distribui PRINCIPAL e TOTAL; o juros e derivado (total - principal).
    v_total_base := ROUND(p_current_value / NULLIF(p_total_installments, 0), 2);
  END IF;

  -- Generate installments (bullet: ciclos)
  FOR i IN 1..v_rows LOOP
    -- Calculate due date based on frequency
    IF p_frequency = 'monthly' THEN
      v_due_date := (
        DATE_TRUNC('month', p_first_due_date + ((i - 1) || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM p_first_due_date)::INTEGER - 1) * INTERVAL '1 day'
      )::DATE;
      v_due_date := LEAST(
        v_due_date,
        (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      );

    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (p_first_due_date + ((i - 1) * 7 || ' days')::INTERVAL)::DATE;

    ELSIF p_frequency = 'freelancer'
       AND p_custom_dates IS NOT NULL
       AND array_length(p_custom_dates, 1) >= i THEN
      v_due_date := p_custom_dates[i];

    ELSE
      -- Daily frequency
      IF p_skip_saturday OR p_skip_sunday THEN
        v_candidate := p_first_due_date;
        -- Advance past initial weekend days
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
           OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
        END LOOP;

        v_bd_count := i - 1;
        WHILE v_bd_count > 0 LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
          IF NOT (
            (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
            OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)
          ) THEN
            v_bd_count := v_bd_count - 1;
          END IF;
        END LOOP;

        v_due_date := v_candidate;
      ELSE
        v_due_date := (p_first_due_date + (i - 1) * INTERVAL '1 day')::DATE;
      END IF;
    END IF;

    IF v_is_bullet THEN
      -- Ciclo = principal + juros exigível (BR-CNT-004). Ciclo pago = só juros
      -- recebidos, principal rolado — mesmo formato de pay_bullet_interest_only.
      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total,
        amount_paid, status, paid_at
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        p_amount_invested, v_interest_per_period,
        ROUND(p_amount_invested + v_interest_per_period, 2),
        CASE WHEN i < v_rows THEN v_interest_per_period ELSE 0 END,
        CASE WHEN i < v_rows THEN 'paid' ELSE 'pending' END,
        CASE WHEN i < v_rows THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
      );
    ELSE
      -- Standard mode
      -- v48: residuo na ULTIMA parcela. Tambem corrige a linha que nao fechava:
      -- amount_total vinha de v_installment_value_rounded, nao de principal+juros.
      IF i < p_total_installments THEN
        v_p := v_amount_principal; v_t := v_total_base;
      ELSE
        v_p := ROUND(p_amount_invested - v_amount_principal * (p_total_installments - 1), 2);
        v_t := ROUND(p_current_value   - v_total_base       * (p_total_installments - 1), 2);
      END IF;
      v_amount_interest := ROUND(v_t - v_p, 2);

      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total,
        amount_paid, status, paid_at
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        v_p, v_amount_interest, v_t,
        CASE WHEN i <= p_paid_count THEN v_t ELSE 0 END,
        CASE WHEN i <= p_paid_count THEN 'paid' ELSE 'pending' END,
        CASE WHEN i <= p_paid_count THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
      );
    END IF;
  END LOOP;

  IF v_is_bullet THEN
    PERFORM public.log_audit_event(
      p_tenant_id, 'bullet_contract_created', 'rpc', auth.uid(), v_target_company_id, v_investment_id, NULL, NULL,
      gen_random_uuid(), NULL, NULL,
      jsonb_build_object('source', 'create_legacy_investment', 'amount_invested', p_amount_invested,
                         'interest_rate', p_interest_rate, 'paid_cycles', v_rows - 1),
      jsonb_build_object('amount_invested', p_amount_invested), NULL, NULL
    );
  END IF;

  RETURN v_investment_id;
END;
$function$;

-- ── 2. Guardas: falta / adiamento não existem no bullet ─────────────────────
CREATE OR REPLACE FUNCTION public.mark_installment_missed(p_installment_id uuid, p_defer_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inst   RECORD;
  v_target RECORD;
  v_new_due DATE;
  v_new_num INTEGER;
  v_new_id  UUID;
  v_target_id UUID;
  v_meta   JSONB;
  v_company_id UUID;
BEGIN
  PERFORM public.assert_installment_in_my_tenant(p_installment_id);
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- v54 (BR-CNT-013)
  IF EXISTS (SELECT 1 FROM investments WHERE id = v_inst.investment_id AND calculation_mode = 'interest_only') THEN
    RAISE EXCEPTION 'Contrato bullet não aceita falta nem adiamento de saldo: o ciclo em aberto segue para atraso e rolagem.';
  END IF;

  -- Herda company_id do contrato pai
  SELECT company_id INTO v_company_id FROM investments WHERE id = v_inst.investment_id;

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
      (investment_id, tenant_id, company_id, number, due_date,
       amount_principal, amount_interest, amount_total, deferred_from_id)
    VALUES
      (v_inst.investment_id, v_inst.tenant_id, v_company_id, v_new_num, v_new_due,
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_remainder_action(p_installment_id uuid, p_action text, p_interest_rate numeric DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inst           loan_installments%ROWTYPE;
  v_remaining      NUMERIC;
  v_amount         NUMERIC;
  v_target         loan_installments%ROWTYPE;
  v_last_any       loan_installments%ROWTYPE;
  v_new_id         UUID;
  v_result         JSON;
  v_do_create      BOOLEAN := false;
  v_company_id     UUID;
BEGIN
  PERFORM public.assert_installment_in_my_tenant(p_installment_id);
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- v54 (BR-CNT-013)
  IF EXISTS (SELECT 1 FROM investments WHERE id = v_inst.investment_id AND calculation_mode = 'interest_only') THEN
    RAISE EXCEPTION 'Contrato bullet não aceita falta nem adiamento de saldo: o ciclo em aberto segue para atraso e rolagem.';
  END IF;

  -- Herda company_id do contrato pai
  SELECT company_id INTO v_company_id FROM investments WHERE id = v_inst.investment_id;

  v_remaining := GREATEST(0,
    (v_inst.amount_total + v_inst.fine_amount + v_inst.interest_delay_amount) - v_inst.amount_paid
  );
  IF v_remaining <= 0 THEN
    RETURN json_build_object('action', 'none', 'message', 'Sem saldo residual');
  END IF;

  v_amount := v_remaining * (1 + COALESCE(p_interest_rate, 0) / 100.0);

  IF p_action = 'last' THEN
    SELECT * INTO v_target
    FROM loan_installments
    WHERE investment_id = v_inst.investment_id
      AND id != p_installment_id
      AND status IN ('pending', 'late', 'partial')
    ORDER BY due_date DESC, number DESC
    LIMIT 1
    FOR UPDATE;

    IF v_target.id IS NOT NULL THEN
      UPDATE loan_installments SET
        amount_total = amount_total + v_amount,
        updated_at   = NOW()
      WHERE id = v_target.id;
      v_result := json_build_object(
        'action', 'last',
        'target_id', v_target.id,
        'target_number', v_target.number,
        'amount_added', v_amount
      );
    ELSE
      v_do_create := true;
    END IF;

  ELSIF p_action = 'next' THEN
    SELECT * INTO v_target
    FROM loan_installments
    WHERE investment_id = v_inst.investment_id
      AND number > v_inst.number
      AND status IN ('pending', 'late', 'partial')
    ORDER BY number ASC
    LIMIT 1
    FOR UPDATE;

    IF v_target.id IS NOT NULL THEN
      UPDATE loan_installments SET
        amount_total = amount_total + v_amount,
        updated_at   = NOW()
      WHERE id = v_target.id;
      v_result := json_build_object(
        'action', 'next',
        'target_id', v_target.id,
        'target_number', v_target.number,
        'amount_added', v_amount
      );
    ELSE
      v_do_create := true;
    END IF;

  ELSE
    v_do_create := true;
  END IF;

  IF v_do_create THEN
    SELECT * INTO v_last_any
    FROM loan_installments
    WHERE investment_id = v_inst.investment_id
    ORDER BY number DESC
    LIMIT 1;

    v_new_id := gen_random_uuid();
    INSERT INTO loan_installments (
      id, investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total,
      amount_paid, fine_amount, interest_delay_amount, status,
      deferred_from_id
    ) VALUES (
      v_new_id, v_inst.investment_id, v_inst.tenant_id, v_company_id,
      COALESCE(v_last_any.number, v_inst.number) + 1,
      COALESCE(v_last_any.due_date, v_inst.due_date) + INTERVAL '30 days',
      v_remaining,
      v_amount - v_remaining,
      v_amount,
      0, 0, 0, 'pending',
      p_installment_id
    );
    UPDATE investments SET
      total_installments = total_installments + 1
    WHERE id = v_inst.investment_id;
    v_result := json_build_object(
      'action', 'new',
      'new_installment_id', v_new_id,
      'amount_added', v_amount
    );
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.defer_remaining_to_last(p_installment_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inst loan_installments%ROWTYPE;
  v_remaining NUMERIC;
  v_last_inst loan_installments%ROWTYPE;
  v_new_id UUID;
  v_result JSON;
  v_company_id UUID;
BEGIN
  PERFORM public.assert_installment_in_my_tenant(p_installment_id);
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- v54 (BR-CNT-013)
  IF EXISTS (SELECT 1 FROM investments WHERE id = v_inst.investment_id AND calculation_mode = 'interest_only') THEN
    RAISE EXCEPTION 'Contrato bullet não aceita falta nem adiamento de saldo: o ciclo em aberto segue para atraso e rolagem.';
  END IF;

  -- Herda company_id do contrato pai
  SELECT company_id INTO v_company_id FROM investments WHERE id = v_inst.investment_id;

  v_remaining := GREATEST(0,
    (v_inst.amount_total + v_inst.fine_amount + v_inst.interest_delay_amount) - v_inst.amount_paid
  );
  IF v_remaining <= 0 THEN
    RETURN json_build_object('action', 'none', 'message', 'Sem saldo residual');
  END IF;

  UPDATE loan_installments SET
    status = 'paid',
    paid_at = NOW(),
    updated_at = NOW()
  WHERE id = p_installment_id;

  SELECT * INTO v_last_inst
  FROM loan_installments
  WHERE investment_id = v_inst.investment_id
    AND id != p_installment_id
  ORDER BY due_date DESC, number DESC
  LIMIT 1;

  IF v_last_inst.id IS NOT NULL AND v_last_inst.status IN ('pending', 'late', 'partial') THEN
    UPDATE loan_installments SET
      amount_total = amount_total + v_remaining,
      updated_at = NOW()
    WHERE id = v_last_inst.id;

    v_result := json_build_object(
      'action', 'accumulated',
      'target_installment_id', v_last_inst.id,
      'target_number', v_last_inst.number,
      'amount_deferred', v_remaining
    );
  ELSE
    v_new_id := gen_random_uuid();
    INSERT INTO loan_installments (
      id, investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total,
      amount_paid, fine_amount, interest_delay_amount, status
    ) VALUES (
      v_new_id,
      v_inst.investment_id,
      v_inst.tenant_id,
      v_company_id,
      COALESCE(v_last_inst.number, v_inst.number) + 1,
      COALESCE(v_last_inst.due_date, v_inst.due_date) + INTERVAL '30 days',
      v_remaining, 0, v_remaining,
      0, 0, 0, 'pending'
    );

    UPDATE investments SET
      renewals = COALESCE(renewals, 0) + 1,
      total_installments = total_installments + 1
    WHERE id = v_inst.investment_id;

    v_result := json_build_object(
      'action', 'created',
      'new_installment_id', v_new_id,
      'amount_deferred', v_remaining
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- ── 3. Saneamento dos 6 bullets afetados ────────────────────────────────────
-- Cada bloco confere o estado lido em 2026-11-08 e aborta se mudou.
DO $$
DECLARE n INTEGER;
BEGIN
  -- 520 (Jubileu): 7 ciclos de juros atrasados ficam (dívida real); os 5
  -- futuros e a linha só de principal saem; o ciclo de 10/11 vira o ciclo
  -- aberto principal + juros.
  DELETE FROM loan_installments li
   WHERE li.investment_id = 520 AND li.number BETWEEN 9 AND 13
     AND li.status = 'pending' AND COALESCE(li.amount_paid, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.installment_id = li.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION '520: esperava apagar 5 linhas, apagaria %', n; END IF;

  UPDATE loan_installments SET amount_principal = 1000, amount_interest = 100, amount_total = 1100, updated_at = NOW()
   WHERE investment_id = 520 AND number = 8 AND status = 'pending' AND COALESCE(amount_paid, 0) = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '520: ciclo 8 não está pendente/intacto'; END IF;

  UPDATE investments SET total_installments = NULL, bullet_principal_mode = NULL, current_value = 1000, updated_at = NOW()
   WHERE id = 520 AND calculation_mode = 'interest_only';

  -- 599, 632, 633: principal já recebido (txs de 400 / 2400 / 1200) → quitados.
  UPDATE investments SET total_installments = NULL, bullet_principal_mode = NULL,
         current_value = amount_invested, remaining_balance = 0, status = 'completed', updated_at = NOW()
   WHERE id IN (599, 632, 633) AND calculation_mode = 'interest_only' AND status = 'active'
     AND NOT EXISTS (SELECT 1 FROM loan_installments li WHERE li.investment_id = investments.id AND li.status <> 'paid');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN RAISE EXCEPTION '599/632/633: esperava quitar 3, quitaria %', n; END IF;

  -- 1381: tira a marca de falta do ciclo aberto.
  UPDATE loan_installments SET missed_at = NULL, updated_at = NOW()
   WHERE investment_id = 1381 AND number = 2 AND missed_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '1381: ciclo 2 sem marca de falta'; END IF;

  -- 3098: ciclo 1 teve só juros pagos (rolagem) e o principal foi "adiado"
  -- para uma linha só de principal. Vira: ciclo 1 pago + ciclo 2 = principal + juros.
  UPDATE loan_installments SET status = 'paid', paid_at = COALESCE(paid_at, '2026-05-19T12:00:00-03'), updated_at = NOW()
   WHERE investment_id = 3098 AND number = 1 AND status = 'partial' AND amount_paid = 100;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '3098: ciclo 1 mudou'; END IF;
  UPDATE loan_installments SET amount_interest = 100, amount_total = 1100, deferred_from_id = NULL, updated_at = NOW()
   WHERE investment_id = 3098 AND number = 2 AND COALESCE(amount_paid, 0) = 0 AND deferred_from_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '3098: ciclo 2 mudou'; END IF;

  -- Trilha de auditoria por contrato saneado.
  PERFORM public.log_audit_event(i.tenant_id, 'bullet_data_fix', 'migration', NULL, i.company_id, i.id, NULL, NULL,
          gen_random_uuid(), NULL, NULL,
          jsonb_build_object('migration', 'v54', 'rule', 'BR-CNT-013', 'status', i.status, 'remaining_balance', i.remaining_balance),
          NULL, NULL, NULL)
    FROM investments i WHERE i.id IN (520, 599, 632, 633, 1381, 3098);
END $$;
