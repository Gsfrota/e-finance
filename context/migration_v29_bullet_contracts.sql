-- ============================================================================
-- Migration V29: Bullet (Interest-Only) Contract Modality
-- ============================================================================
-- Adds support for "Juros Apenas" contracts where:
-- - The debtor pays only interest each period (simple interest on original principal)
-- - The principal remains intact until maturity
-- - At maturity: "together" = last installment includes principal + interest
--               "separate" = N interest installments + 1 extra principal-only installment
-- ============================================================================

-- 1. Add new columns to investments table
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS bullet_principal_mode TEXT DEFAULT NULL;

-- Add check constraint for valid values
ALTER TABLE public.investments
  ADD CONSTRAINT chk_bullet_principal_mode
  CHECK (bullet_principal_mode IS NULL OR bullet_principal_mode IN ('together', 'separate'));

-- 2. Create new overload of create_investment_validated with bullet support
DROP FUNCTION IF EXISTS public.create_investment_validated(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[], UUID, TEXT
);

CREATE OR REPLACE FUNCTION public.create_investment_validated(
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
  p_due_day INTEGER DEFAULT NULL,
  p_weekday INTEGER DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_calculation_mode TEXT DEFAULT 'manual',
  p_skip_saturday BOOLEAN DEFAULT false,
  p_skip_sunday BOOLEAN DEFAULT false,
  p_custom_dates DATE[] DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
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
  v_base_date DATE;
  v_effective_day INTEGER;
  v_bd_count INTEGER;
  v_candidate DATE;
  v_target_company_id UUID;
  v_is_bullet BOOLEAN;
  v_interest_per_period NUMERIC;
  v_total_interest_installments INTEGER;
  i INTEGER;
BEGIN
  -- Tenant validation
  IF auth.uid() IS NOT NULL
     AND public.get_tenant_id_safe() IS NOT NULL
     AND p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;

  v_target_company_id := public.resolve_company_id_for_tenant(
    p_tenant_id,
    p_company_id,
    p_user_id,
    p_payer_id
  );

  v_is_bullet := (p_calculation_mode = 'interest_only');
  v_installment_value_rounded := ROUND(p_installment_value::numeric, 2);

  -- For bullet mode, calculate interest per period (simple interest on original principal)
  IF v_is_bullet THEN
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;

    -- For "together" mode: last installment = interest + principal
    -- For "separate" mode: N interest installments + 1 extra principal installment
    IF p_bullet_principal_mode = 'together' THEN
      v_total_interest_installments := p_total_installments;
    ELSE
      v_total_interest_installments := p_total_installments;
      -- separate mode adds +1 installment for principal return
    END IF;
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
    CASE WHEN v_is_bullet AND p_bullet_principal_mode = 'separate'
      THEN p_total_installments + 1
      ELSE p_total_installments
    END,
    p_frequency,
    p_due_day,
    p_weekday,
    p_start_date,
    p_calculation_mode,
    p_source_capital,
    p_source_profit,
    p_bullet_principal_mode
  )
  RETURNING id INTO v_investment_id;

  -- Calculate installment amounts based on mode
  IF NOT v_is_bullet THEN
    -- Standard Price mode: distribute principal + interest evenly
    v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
    v_amount_interest := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);
  END IF;

  -- Calculate base date for monthly frequency
  IF p_frequency = 'monthly' THEN
    v_effective_day := COALESCE(p_due_day, 1);
    IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
      v_base_date := (
        DATE_TRUNC('month', CURRENT_DATE)
        + (v_effective_day - 1) * INTERVAL '1 day'
      )::DATE;
    ELSE
      v_base_date := (
        DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')
        + (v_effective_day - 1) * INTERVAL '1 day'
      )::DATE;
    END IF;
  END IF;

  -- Generate installments
  FOR i IN 1..p_total_installments LOOP
    -- Calculate due date (same logic as before)
    IF p_frequency = 'monthly' THEN
      v_due_date := (
        DATE_TRUNC('month', v_base_date + ((i - 1) || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day'
      )::DATE;
      v_due_date := LEAST(
        v_due_date,
        (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      );
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (CURRENT_DATE + (i * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer'
       AND p_custom_dates IS NOT NULL
       AND array_length(p_custom_dates, 1) >= i THEN
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
          IF NOT (
            (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
            OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)
          ) THEN
            v_bd_count := v_bd_count - 1;
          END IF;
        END LOOP;

        v_due_date := v_candidate;
      ELSE
        v_due_date := (COALESCE(p_start_date, CURRENT_DATE) + (i - 1) * INTERVAL '1 day')::DATE;
      END IF;
    END IF;

    IF v_is_bullet THEN
      -- Bullet mode: interest-only installments
      IF p_bullet_principal_mode = 'together' AND i = p_total_installments THEN
        -- Last installment: interest + principal
        INSERT INTO public.loan_installments (
          investment_id, tenant_id, company_id, number, due_date,
          amount_principal, amount_interest, amount_total
        ) VALUES (
          v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
          p_amount_invested, v_interest_per_period,
          ROUND(p_amount_invested + v_interest_per_period, 2)
        );
      ELSE
        -- Regular interest-only installment
        INSERT INTO public.loan_installments (
          investment_id, tenant_id, company_id, number, due_date,
          amount_principal, amount_interest, amount_total
        ) VALUES (
          v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
          0, v_interest_per_period, v_interest_per_period
        );
      END IF;
    ELSE
      -- Standard mode
      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        v_amount_principal, v_amount_interest, v_installment_value_rounded
      );
    END IF;
  END LOOP;

  -- For bullet "separate" mode: add one extra installment for principal return
  IF v_is_bullet AND p_bullet_principal_mode = 'separate' THEN
    -- Calculate next due date after last interest installment
    IF p_frequency = 'monthly' THEN
      v_due_date := (
        DATE_TRUNC('month', v_base_date + (p_total_installments || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day'
      )::DATE;
      v_due_date := LEAST(
        v_due_date,
        (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      );
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
      p_total_installments + 1, v_due_date,
      p_amount_invested, 0, p_amount_invested
    );
  END IF;

  RETURN v_investment_id;
END;
$$;

-- Grant permissions for the new overload
GRANT EXECUTE ON FUNCTION public.create_investment_validated(
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[], UUID, TEXT
) TO authenticated, service_role;
