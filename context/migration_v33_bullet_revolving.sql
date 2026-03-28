-- ============================================================================
-- Migration V33: Bullet Revolving Credit (Crédito Rotativo)
-- ============================================================================
-- REGRA ANTI-RECORRÊNCIA (aprendido com bug v34):
-- CREATE OR REPLACE FUNCTION com assinatura diferente NÃO substitui o overload anterior
-- no PostgreSQL — cria um novo. Sempre incluir DROP FUNCTION IF EXISTS para todas as
-- versões anteriores ANTES do CREATE OR REPLACE ao adicionar novos parâmetros a uma RPC.
-- ============================================================================
-- Substitui o modelo bullet antigo (parcelas fixas) pelo modelo rotativo:
-- - Cliente paga qualquer valor por período (mín. juros)
-- - Juros calculado sobre o saldo devedor atual (não o principal original)
-- - Sem número fixo de parcelas — fecha quando saldo = 0
-- - Juros não pago capitaliza por default (configurável por contrato)
-- ============================================================================

-- 1. Novos campos em investments
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS capitalize_interest BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN public.investments.remaining_balance IS
  'Saldo devedor atual do contrato bullet rotativo. NULL = contrato não-bullet.';
COMMENT ON COLUMN public.investments.capitalize_interest IS
  'Se TRUE, juros não pago soma ao saldo devedor (capitaliza). Se FALSE, fica como multa separada.';

-- 2. Backfill para contratos bullet existentes
UPDATE public.investments
SET remaining_balance = amount_invested
WHERE calculation_mode = 'interest_only' AND remaining_balance IS NULL;

-- ============================================================================
-- 3. RPC: generate_next_bullet_installment
-- Gera a próxima parcela de juros com base no saldo devedor atual
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

  -- Inserir nova parcela
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
$$;

GRANT EXECUTE ON FUNCTION public.generate_next_bullet_installment(BIGINT)
  TO authenticated, service_role;

-- ============================================================================
-- 4. RPC: process_bullet_payment
-- Processa pagamento flexível: deduz juros primeiro, depois principal
-- Gera próxima parcela se saldo > 0. Fecha contrato se saldo = 0.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_bullet_payment(
  p_installment_id  UUID,
  p_amount          NUMERIC,
  p_paid_at         TIMESTAMPTZ DEFAULT NOW(),
  p_payment_method  TEXT DEFAULT 'PIX'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inst              loan_installments%ROWTYPE;
  v_inv               investments%ROWTYPE;
  v_interest_due      NUMERIC;
  v_interest_paid     NUMERIC;
  v_principal_paid    NUMERIC;
  v_new_balance       NUMERIC;
  v_amount            NUMERIC;
  v_next_id           UUID;
  v_unpaid_interest   NUMERIC;
  v_installment_done  BOOLEAN;
BEGIN
  -- Lock parcela e contrato
  SELECT * INTO v_inst FROM public.loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada: %', p_installment_id; END IF;

  SELECT * INTO v_inv FROM public.investments WHERE id = v_inst.investment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado: %', v_inst.investment_id; END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'Valor deve ser positivo'; END IF;
  IF v_inst.status = 'paid' THEN RAISE EXCEPTION 'Esta parcela já está quitada.'; END IF;

  -- Saldo devedor atual
  v_new_balance := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);

  -- Juros em aberto da parcela (descontando já pago via interest_payments_total)
  v_interest_due := GREATEST(0,
    v_inst.amount_interest - COALESCE(v_inst.interest_payments_total, 0)
  );

  -- Limitar pagamento ao total devido (juros pendente + saldo devedor)
  v_amount := LEAST(p_amount, v_interest_due + v_new_balance);

  -- Alocar: juros primeiro, depois principal
  v_interest_paid  := LEAST(v_amount, v_interest_due);
  v_principal_paid := GREATEST(0, v_amount - v_interest_paid);

  -- Novo saldo devedor
  v_new_balance := ROUND(v_new_balance - v_principal_paid, 2);

  -- Parcela ficou quitada?
  v_installment_done := (COALESCE(v_inst.amount_paid, 0) + v_amount) >= v_inst.amount_total;

  -- Atualizar parcela
  UPDATE public.loan_installments SET
    amount_paid             = COALESCE(amount_paid, 0) + v_amount,
    interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_paid,
    status = CASE WHEN v_installment_done THEN 'paid' ELSE 'partial' END,
    paid_at = CASE WHEN v_installment_done THEN p_paid_at ELSE paid_at END,
    payment_method = p_payment_method,
    updated_at = NOW()
  WHERE id = p_installment_id;

  -- Atualizar remaining_balance e status do contrato
  UPDATE public.investments SET
    remaining_balance = v_new_balance,
    status = CASE WHEN v_new_balance <= 0.01 THEN 'completed' ELSE status END,
    updated_at = NOW()
  WHERE id = v_inv.id;

  -- Se parcela quitada e saldo > 0: gerar próxima parcela
  IF v_installment_done AND v_new_balance > 0.01 THEN
    -- Juros não pago? Capitalizar se configurado
    v_unpaid_interest := GREATEST(0, v_interest_due - v_interest_paid);
    IF COALESCE(v_inv.capitalize_interest, TRUE) AND v_unpaid_interest > 0.01 THEN
      v_new_balance := ROUND(v_new_balance + v_unpaid_interest, 2);
      UPDATE public.investments SET remaining_balance = v_new_balance WHERE id = v_inv.id;
    END IF;

    v_next_id := public.generate_next_bullet_installment(v_inv.id);
  END IF;

  RETURN json_build_object(
    'interest_paid',         v_interest_paid,
    'principal_paid',        v_principal_paid,
    'new_balance',           v_new_balance,
    'next_installment_id',   v_next_id,
    'contract_closed',       v_new_balance <= 0.01
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_bullet_payment(UUID, NUMERIC, TIMESTAMPTZ, TEXT)
  TO authenticated, service_role;

-- ============================================================================
-- 5. Novo overload de create_investment_validated com p_capitalize_interest
-- Para bullet: gera só 1 parcela, seta remaining_balance, total_installments = NULL
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

  -- Para bullet rotativo: gera apenas a 1ª parcela
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
  UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[], UUID, TEXT, BOOLEAN
) TO authenticated, service_role;
