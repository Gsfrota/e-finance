-- Migration v33: Enhanced create_legacy_investment
-- Alinha RPC de contratos antigos com create_investment_validated (v29)
-- Adiciona: bullet (interest_only), skip weekends, weekday, freelancer custom_dates

-- Drop old signature (v28 had 17 params)
DROP FUNCTION IF EXISTS public.create_legacy_investment(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, DATE, INTEGER, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.create_legacy_investment(
  p_tenant_id UUID,
  p_user_id UUID,
  p_payer_id UUID,
  p_asset_name TEXT,
  p_amount_invested NUMERIC,
  p_source_capital NUMERIC DEFAULT 0,
  p_source_profit NUMERIC DEFAULT 0,
  p_current_value NUMERIC DEFAULT 0,
  p_interest_rate NUMERIC DEFAULT 0,
  p_installment_value NUMERIC DEFAULT 0,
  p_total_installments INTEGER DEFAULT 1,
  p_frequency TEXT DEFAULT 'monthly',
  p_first_due_date DATE DEFAULT CURRENT_DATE,
  p_paid_count INTEGER DEFAULT 0,
  p_calculation_mode TEXT DEFAULT 'manual',
  p_original_code TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  -- New params (v33)
  p_skip_saturday BOOLEAN DEFAULT false,
  p_skip_sunday BOOLEAN DEFAULT false,
  p_weekday INTEGER DEFAULT NULL,
  p_custom_dates DATE[] DEFAULT NULL,
  p_bullet_principal_mode TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
  v_actual_total_installments INTEGER;
  i INTEGER;
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

  -- Bullet mode: calculate interest per period
  IF v_is_bullet THEN
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;
  END IF;

  -- Actual total installments (separate bullet adds +1)
  IF v_is_bullet AND p_bullet_principal_mode = 'separate' THEN
    v_actual_total_installments := p_total_installments + 1;
  ELSE
    v_actual_total_installments := p_total_installments;
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
    bullet_principal_mode
  )
  VALUES (
    p_tenant_id,
    v_target_company_id,
    p_user_id,
    p_payer_id,
    p_asset_name,
    p_amount_invested,
    p_current_value,
    p_interest_rate,
    v_installment_value_rounded,
    v_actual_total_installments,
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
    p_bullet_principal_mode
  )
  RETURNING id INTO v_investment_id;

  -- Calculate per-installment amounts for standard mode
  IF NOT v_is_bullet THEN
    v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
    v_amount_interest := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);
  END IF;

  -- Generate installments
  FOR i IN 1..p_total_installments LOOP
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

    -- Insert installment based on mode
    IF v_is_bullet THEN
      IF p_bullet_principal_mode = 'together' AND i = p_total_installments THEN
        -- Last installment: interest + principal
        INSERT INTO public.loan_installments (
          investment_id, tenant_id, company_id, number, due_date,
          amount_principal, amount_interest, amount_total,
          amount_paid, status, paid_at
        ) VALUES (
          v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
          p_amount_invested, v_interest_per_period,
          ROUND(p_amount_invested + v_interest_per_period, 2),
          CASE WHEN i <= p_paid_count THEN ROUND(p_amount_invested + v_interest_per_period, 2) ELSE 0 END,
          CASE WHEN i <= p_paid_count THEN 'paid' ELSE 'pending' END,
          CASE WHEN i <= p_paid_count THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
        );
      ELSE
        -- Regular interest-only installment
        INSERT INTO public.loan_installments (
          investment_id, tenant_id, company_id, number, due_date,
          amount_principal, amount_interest, amount_total,
          amount_paid, status, paid_at
        ) VALUES (
          v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
          0, v_interest_per_period, v_interest_per_period,
          CASE WHEN i <= p_paid_count THEN v_interest_per_period ELSE 0 END,
          CASE WHEN i <= p_paid_count THEN 'paid' ELSE 'pending' END,
          CASE WHEN i <= p_paid_count THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
        );
      END IF;
    ELSE
      -- Standard mode
      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total,
        amount_paid, status, paid_at
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        v_amount_principal, v_amount_interest, v_installment_value_rounded,
        CASE WHEN i <= p_paid_count THEN v_installment_value_rounded ELSE 0 END,
        CASE WHEN i <= p_paid_count THEN 'paid' ELSE 'pending' END,
        CASE WHEN i <= p_paid_count THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
      );
    END IF;
  END LOOP;

  -- Bullet "separate" mode: add extra principal-only installment
  IF v_is_bullet AND p_bullet_principal_mode = 'separate' THEN
    IF p_frequency = 'monthly' THEN
      v_due_date := (
        DATE_TRUNC('month', p_first_due_date + (p_total_installments || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM p_first_due_date)::INTEGER - 1) * INTERVAL '1 day'
      )::DATE;
      v_due_date := LEAST(
        v_due_date,
        (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      );
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (p_first_due_date + (p_total_installments * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer'
       AND p_custom_dates IS NOT NULL
       AND array_length(p_custom_dates, 1) > p_total_installments THEN
      v_due_date := p_custom_dates[p_total_installments + 1];
    ELSE
      -- Daily (with or without skip weekends)
      IF p_skip_saturday OR p_skip_sunday THEN
        v_candidate := p_first_due_date;
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
           OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
        END LOOP;
        v_bd_count := p_total_installments;
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
        v_due_date := (p_first_due_date + p_total_installments * INTERVAL '1 day')::DATE;
      END IF;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total,
      amount_paid, status, paid_at
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id,
      p_total_installments + 1, v_due_date,
      p_amount_invested, 0, p_amount_invested,
      CASE WHEN (p_total_installments + 1) <= p_paid_count THEN p_amount_invested ELSE 0 END,
      CASE WHEN (p_total_installments + 1) <= p_paid_count THEN 'paid' ELSE 'pending' END,
      CASE WHEN (p_total_installments + 1) <= p_paid_count THEN (v_due_date + INTERVAL '1 day')::TIMESTAMPTZ ELSE NULL END
    );
  END IF;

  RETURN v_investment_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.create_legacy_investment(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, DATE, INTEGER, TEXT, TEXT, UUID,
  BOOLEAN, BOOLEAN, INTEGER, DATE[], TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_legacy_investment(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, DATE, INTEGER, TEXT, TEXT, UUID,
  BOOLEAN, BOOLEAN, INTEGER, DATE[], TEXT
) TO service_role;
