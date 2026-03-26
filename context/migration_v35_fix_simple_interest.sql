-- ============================================================================
-- Migration V35: Correção do Fluxo de Juros Simples (Bullet/Interest-Only)
-- ============================================================================
-- PROBLEMA:
--   Contratos interest_only criavam parcelas com amount_total = amount_interest
--   (ex: R$10), quando o correto é amount_total = principal + juros (ex: R$110).
--   O InterestOnlyModal chamava pay_interest_only que não gerava próxima parcela
--   nem marcava a parcela como paga.
--
-- MUDANÇAS:
--   A) generate_next_bullet_installment: amount_principal = saldo, amount_total = saldo + juros
--   B) create_investment_validated: primeira parcela bullet com principal + juros
--   C) Nova RPC pay_bullet_interest_only: baixa de juros correta (marca paid + gera próxima)
--
-- REGRA ANTI-RECORRÊNCIA (v34):
--   Nenhuma assinatura nova foi adicionada — CREATE OR REPLACE substitui in-place.
-- ============================================================================

-- ============================================================================
-- A) Corrigir generate_next_bullet_installment
-- Parcelas geradas automaticamente devem mostrar principal + juros no amount_total
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_next_bullet_installment(
  p_investment_id BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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

  -- Busca a última parcela para calcular próxima data e número
  SELECT * INTO v_last_inst
  FROM public.loan_installments
  WHERE investment_id = p_investment_id
  ORDER BY number DESC
  LIMIT 1;

  v_next_number := COALESCE(v_last_inst.number, 0) + 1;
  v_balance := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);

  -- Calcular próxima data de vencimento
  IF v_last_inst.due_date IS NULL THEN
    -- Primeira parcela: usa lógica padrão de due_day
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
    -- Calcula próxima data a partir da última parcela
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

  -- Calcular juros sobre saldo devedor atual
  v_interest := ROUND(v_balance * (v_inv.interest_rate / 100), 2);

  -- Inserir nova parcela: amount_principal = saldo, amount_total = saldo + juros
  INSERT INTO public.loan_installments (
    investment_id, tenant_id, company_id, number, due_date,
    amount_principal, amount_interest, amount_total, status
  ) VALUES (
    p_investment_id, v_inv.tenant_id, v_inv.company_id,
    v_next_number, v_next_due,
    v_balance, v_interest, v_balance + v_interest, 'pending'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_next_bullet_installment(BIGINT)
  TO authenticated, service_role;

-- ============================================================================
-- B) Corrigir create_investment_validated
-- Primeira parcela bullet deve incluir principal no amount_total
-- Assinatura idêntica à v33 (22 params) — CREATE OR REPLACE substitui in-place
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_investment_validated(
  p_tenant_id             UUID,
  p_user_id               UUID,
  p_payer_id              UUID,
  p_asset_name            TEXT,
  p_amount_invested       NUMERIC,
  p_source_capital        NUMERIC DEFAULT 0,
  p_source_profit         NUMERIC DEFAULT 0,
  p_current_value         NUMERIC DEFAULT 0,
  p_interest_rate         NUMERIC DEFAULT 0,
  p_installment_value     NUMERIC DEFAULT 0,
  p_total_installments    INTEGER DEFAULT 1,
  p_frequency             TEXT DEFAULT 'monthly',
  p_due_day               INTEGER DEFAULT NULL,
  p_weekday               INTEGER DEFAULT NULL,
  p_start_date            DATE DEFAULT NULL,
  p_calculation_mode      TEXT DEFAULT 'manual',
  p_skip_saturday         BOOLEAN DEFAULT false,
  p_skip_sunday           BOOLEAN DEFAULT false,
  p_custom_dates          DATE[] DEFAULT NULL,
  p_company_id            UUID DEFAULT NULL,
  p_bullet_principal_mode TEXT DEFAULT NULL,
  p_capitalize_interest   BOOLEAN DEFAULT TRUE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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

  -- Para bullet rotativo: gera apenas a 1ª parcela com principal + juros no amount_total
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

    -- Primeira parcela: amount_principal = principal investido, amount_total = principal + juros
    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total, status
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id, 1, v_due_date,
      p_amount_invested, v_interest_per_period, p_amount_invested + v_interest_per_period, 'pending'
    );

    RETURN v_investment_id;
  END IF;

  -- Lógica original para contratos não-bullet (mantida intacta — idêntica à v33)
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

  -- Para bullet legado "separate": parcela extra de principal
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
$$;

GRANT EXECUTE ON FUNCTION public.create_investment_validated(
  UUID, UUID, UUID, TEXT, NUMERIC,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  INTEGER, TEXT, INTEGER, INTEGER, DATE,
  TEXT, BOOLEAN, BOOLEAN, DATE[], UUID, TEXT, BOOLEAN
) TO authenticated, service_role;

-- ============================================================================
-- C) Nova RPC: pay_bullet_interest_only
-- Baixa de juros para contratos interest_only:
-- - Paga exatamente os juros devidos da parcela atual
-- - Marca parcela como 'paid'
-- - NÃO reduz remaining_balance (principal continua em aberto)
-- - Gera próxima parcela automaticamente via generate_next_bullet_installment
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pay_bullet_interest_only(
  p_installment_id UUID,
  p_paid_at        TIMESTAMPTZ DEFAULT NOW(),
  p_payment_method TEXT DEFAULT 'PIX'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inst          loan_installments%ROWTYPE;
  v_inv           investments%ROWTYPE;
  v_interest_due  NUMERIC;
  v_next_id       UUID;
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

  -- Calcular juros pendentes (descontando o que já foi pago via interest_payments_total)
  v_interest_due := GREATEST(0,
    v_inst.amount_interest - COALESCE(v_inst.interest_payments_total, 0)
  );

  IF v_interest_due <= 0.005 THEN
    RAISE EXCEPTION 'Juros já quitados nesta parcela.';
  END IF;

  -- Marcar parcela como paga (só pelos juros — principal permanece como saldo devedor)
  UPDATE public.loan_installments SET
    amount_paid             = COALESCE(amount_paid, 0) + v_interest_due,
    interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_due,
    status                  = 'paid',
    paid_at                 = p_paid_at,
    payment_method          = p_payment_method,
    updated_at              = NOW()
  WHERE id = p_installment_id;

  -- remaining_balance NÃO muda: o principal continua em aberto

  -- Gerar próxima parcela (juros sobre o mesmo saldo devedor)
  v_next_id := public.generate_next_bullet_installment(v_inv.id);

  RETURN json_build_object(
    'interest_paid',       v_interest_due,
    'new_balance',         COALESCE(v_inv.remaining_balance, v_inv.amount_invested),
    'next_installment_id', v_next_id,
    'contract_closed',     false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT)
  TO authenticated, service_role;

-- Verificação: confirmar que cada função existe com exatamente 1 overload
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE nspname = 'public'
--   AND proname IN ('generate_next_bullet_installment', 'create_investment_validated', 'pay_bullet_interest_only')
-- ORDER BY proname;
