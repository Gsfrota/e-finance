-- ============================================================================
-- ROLLBACK da Migration V35: Restaura funções ao estado anterior (v33)
-- Capturado em: 2026-03-26
-- Aplicar em caso de problema com migration_v35_fix_simple_interest.sql
-- ============================================================================

-- Remove nova RPC (criada pela v35, não existia antes)
DROP FUNCTION IF EXISTS public.pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT);

-- Restaura generate_next_bullet_installment (v33: amount_principal=0, amount_total=juros)
CREATE OR REPLACE FUNCTION public.generate_next_bullet_installment(p_investment_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_inv         investments%ROWTYPE;
  v_last_inst   loan_installments%ROWTYPE;
  v_next_number INTEGER;
  v_next_due    DATE;
  v_interest    NUMERIC;
  v_new_id      UUID;
  v_balance     NUMERIC;
  v_eff_day     INTEGER;
BEGIN
  SELECT * INTO v_inv FROM public.investments WHERE id = p_investment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado: %', p_investment_id; END IF;

  SELECT * INTO v_last_inst
  FROM public.loan_installments
  WHERE investment_id = p_investment_id
  ORDER BY number DESC
  LIMIT 1;

  v_next_number := COALESCE(v_last_inst.number, 0) + 1;
  v_balance := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);

  IF v_last_inst.due_date IS NULL THEN
    IF v_inv.frequency = 'monthly' THEN
      v_eff_day := COALESCE(v_inv.due_day, 1);
      IF v_eff_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
        v_next_due := (DATE_TRUNC('month', CURRENT_DATE) + (v_eff_day - 1) * INTERVAL '1 day')::DATE;
      ELSE
        v_next_due := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_eff_day - 1) * INTERVAL '1 day')::DATE;
      END IF;
      v_next_due := LEAST(v_next_due, (DATE_TRUNC('month', v_next_due) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF v_inv.frequency = 'weekly' THEN
      v_next_due := (CURRENT_DATE + INTERVAL '7 days')::DATE;
    ELSE
      v_next_due := (CURRENT_DATE + INTERVAL '1 day')::DATE;
    END IF;
  ELSE
    IF v_inv.frequency = 'monthly' THEN
      v_next_due := (DATE_TRUNC('month', v_last_inst.due_date + INTERVAL '1 month')
        + (COALESCE(v_inv.due_day, EXTRACT(DAY FROM v_last_inst.due_date)::INTEGER) - 1) * INTERVAL '1 day')::DATE;
      v_next_due := LEAST(v_next_due, (DATE_TRUNC('month', v_next_due) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF v_inv.frequency = 'weekly' THEN
      v_next_due := (v_last_inst.due_date + INTERVAL '7 days')::DATE;
    ELSE
      v_next_due := (v_last_inst.due_date + INTERVAL '1 day')::DATE;
    END IF;
  END IF;

  v_interest := ROUND(v_balance * (v_inv.interest_rate / 100), 2);

  INSERT INTO public.loan_installments (
    investment_id, tenant_id, company_id, number, due_date,
    amount_principal, amount_interest, amount_total, status
  ) VALUES (
    p_investment_id, v_inv.tenant_id, v_inv.company_id,
    v_next_number, v_next_due,
    0, v_interest, v_interest, 'pending'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_next_bullet_installment(BIGINT)
  TO authenticated, service_role;

-- Restaura create_investment_validated (v33: primeira parcela bullet com amount_total=juros)
CREATE OR REPLACE FUNCTION public.create_investment_validated(p_tenant_id uuid, p_user_id uuid, p_payer_id uuid, p_asset_name text, p_amount_invested numeric, p_source_capital numeric DEFAULT 0, p_source_profit numeric DEFAULT 0, p_current_value numeric DEFAULT 0, p_interest_rate numeric DEFAULT 0, p_installment_value numeric DEFAULT 0, p_total_installments integer DEFAULT 1, p_frequency text DEFAULT 'monthly'::text, p_due_day integer DEFAULT NULL::integer, p_weekday integer DEFAULT NULL::integer, p_start_date date DEFAULT NULL::date, p_calculation_mode text DEFAULT 'manual'::text, p_skip_saturday boolean DEFAULT false, p_skip_sunday boolean DEFAULT false, p_custom_dates date[] DEFAULT NULL::date[], p_company_id uuid DEFAULT NULL::uuid, p_bullet_principal_mode text DEFAULT NULL::text, p_capitalize_interest boolean DEFAULT true)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_investment_id             BIGINT;
  v_amount_principal          NUMERIC;
  v_amount_interest           NUMERIC;
  v_installment_value_rounded NUMERIC;
  v_due_date                  DATE;
  v_base_date                 DATE;
  v_effective_day             INTEGER;
  v_bd_count                  INTEGER;
  v_candidate                 DATE;
  v_target_company_id         UUID;
  v_is_bullet                 BOOLEAN;
  v_interest_per_period       NUMERIC;
  i                           INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_tenant_id_safe() IS NOT NULL
     AND p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;

  v_target_company_id := public.resolve_company_id_for_tenant(
    p_tenant_id, p_company_id, p_user_id, p_payer_id
  );

  v_is_bullet := (p_calculation_mode = 'interest_only');
  v_installment_value_rounded := ROUND(p_installment_value::numeric, 2);

  IF v_is_bullet THEN
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;
  END IF;

  INSERT INTO public.investments (
    tenant_id, company_id, user_id, payer_id, asset_name,
    amount_invested, current_value, interest_rate, installment_value,
    total_installments, frequency, due_day, weekday, start_date,
    calculation_mode, source_capital, source_profit,
    bullet_principal_mode, remaining_balance, capitalize_interest
  ) VALUES (
    p_tenant_id, v_target_company_id, p_user_id, p_payer_id, p_asset_name,
    p_amount_invested, p_current_value, p_interest_rate, v_installment_value_rounded,
    CASE WHEN v_is_bullet THEN NULL
         WHEN p_bullet_principal_mode = 'separate' THEN p_total_installments + 1
         ELSE p_total_installments END,
    p_frequency, p_due_day, p_weekday, p_start_date,
    p_calculation_mode, p_source_capital, p_source_profit,
    CASE WHEN v_is_bullet THEN NULL ELSE p_bullet_principal_mode END,
    CASE WHEN v_is_bullet THEN p_amount_invested ELSE NULL END,
    CASE WHEN v_is_bullet THEN p_capitalize_interest ELSE TRUE END
  ) RETURNING id INTO v_investment_id;

  -- Para bullet rotativo: gera apenas a 1ª parcela (v33: amount_total = só juros)
  IF v_is_bullet THEN
    IF p_frequency = 'monthly' THEN
      v_effective_day := COALESCE(p_due_day, 1);
      IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      ELSE
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      END IF;
      v_due_date := LEAST(v_base_date,
        (DATE_TRUNC('month', v_base_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (CURRENT_DATE + INTERVAL '7 days')::DATE;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= 1 THEN
      v_due_date := p_custom_dates[1];
    ELSE
      IF p_skip_saturday OR p_skip_sunday THEN
        v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
           OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
        END LOOP;
        v_due_date := v_candidate;
      ELSE
        v_due_date := COALESCE(p_start_date, CURRENT_DATE);
      END IF;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total, status
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id, 1, v_due_date,
      0, v_interest_per_period, v_interest_per_period, 'pending'
    );

    RETURN v_investment_id;
  END IF;

  -- Lógica original para contratos não-bullet
  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest  := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);

  IF p_frequency = 'monthly' THEN
    v_effective_day := COALESCE(p_due_day, 1);
    IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
      v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
    ELSE
      v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
    END IF;
  END IF;

  FOR i IN 1..p_total_installments LOOP
    IF p_frequency = 'monthly' THEN
      v_due_date := (DATE_TRUNC('month', v_base_date + ((i-1) || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day')::DATE;
      v_due_date := LEAST(v_due_date, (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (CURRENT_DATE + (i * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= i THEN
      v_due_date := p_custom_dates[i];
    ELSE
      IF p_skip_saturday OR p_skip_sunday THEN
        v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
           OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
        END LOOP;
        v_bd_count := i - 1;
        WHILE v_bd_count > 0 LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
          IF NOT ((p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
               OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)) THEN
            v_bd_count := v_bd_count - 1;
          END IF;
        END LOOP;
        v_due_date := v_candidate;
      ELSE
        v_due_date := (COALESCE(p_start_date, CURRENT_DATE) + (i - 1) * INTERVAL '1 day')::DATE;
      END IF;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
      v_amount_principal, v_amount_interest, v_installment_value_rounded
    );
  END LOOP;

  IF p_bullet_principal_mode = 'separate' THEN
    IF p_frequency = 'monthly' THEN
      v_due_date := (DATE_TRUNC('month', v_base_date + (p_total_installments || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day')::DATE;
      v_due_date := LEAST(v_due_date, (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (CURRENT_DATE + ((p_total_installments + 1) * 7 || ' days')::INTERVAL)::DATE;
    ELSE
      v_due_date := (COALESCE(p_start_date, CURRENT_DATE) + p_total_installments * INTERVAL '1 day')::DATE;
    END IF;
    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id,
      p_total_installments + 1, v_due_date, p_amount_invested, 0, p_amount_invested
    );
  END IF;

  RETURN v_investment_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_investment_validated(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[], UUID, TEXT, BOOLEAN
) TO authenticated, service_role;
