-- ============================================================================
-- Migration V40: Correções do Fluxo Bullet (Juros Simples)
-- ============================================================================
-- PROBLEMAS RESOLVIDOS:
--
--   A) pay_avulso: Reescrita com p_destination obrigatório, integração ao ledger
--      (payment_transactions) e lógica correta para contratos bullet
--      (principal_reduction reduz remaining_balance e recalcula parcela pendente).
--
--   B) generate_next_bullet_installment: Guard contra duplicação de parcelas.
--      Se já existe uma parcela pending, retorna ela em vez de criar outra.
--
--   C) create_investment_validated: Respeitar p_start_date quando fornecido
--      para contratos mensais, evitando que a escolha "Este mês" seja ignorada.
--
--   D) payment_transactions: Adicionar 'avulso' ao check constraint de
--      transaction_type para permitir classificação correta.
--
-- ROOT CAUSES CORRIGIDOS:
--   RC-001: p_start_date ignorado para mensais → frontend passa monthOffset
--   RC-002: pay_avulso incompatível com bullet, sem ledger, sem p_destination
--   RC-004: generate_next_bullet_installment duplicava parcelas
-- ============================================================================

-- ============================================================================
-- D) Adicionar 'avulso' ao check constraint de transaction_type
-- ============================================================================
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_transaction_type_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'payment'::text,
    'avulso'::text,
    'surplus_applied'::text,
    'surplus_received'::text,
    'deferred'::text,
    'missed'::text,
    'reversal'::text,
    'late_auto'::text
  ]));

-- Atualizar o registro de audit do avulso do contrato 789 para o tipo correto
UPDATE public.payment_transactions
SET transaction_type = 'avulso'
WHERE notes LIKE '[avulso/principal_reduction]%'
  AND transaction_type = 'payment';

-- ============================================================================
-- B) Guard de duplicação em generate_next_bullet_installment
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

  -- Guard: se já existe parcela pending, retornar ela sem criar outra
  IF EXISTS (
    SELECT 1 FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
  ) THEN
    SELECT id INTO v_new_id FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
    ORDER BY number DESC LIMIT 1;
    RETURN v_new_id;
  END IF;

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
    v_balance, v_interest, v_balance + v_interest, 'pending'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_next_bullet_installment(BIGINT)
  TO authenticated, service_role;

-- ============================================================================
-- A) Reescrever pay_avulso com p_destination, ledger e lógica bullet correta
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pay_avulso(
  p_investment_id BIGINT,
  p_amount        NUMERIC,
  p_paid_at       TIMESTAMPTZ DEFAULT NOW(),
  p_notes         TEXT DEFAULT NULL,
  p_destination   TEXT DEFAULT 'general_credit'  -- 'principal_reduction' | 'penalty_payment' | 'general_credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant_id     UUID    := get_tenant_id_safe();
  v_inv           investments%ROWTYPE;
  v_avulso_id     UUID;
  v_remaining     NUMERIC := p_amount;
  v_inst          RECORD;
  v_applied       JSONB   := '[]'::JSONB;
  v_outstanding   NUMERIC;
  v_new_balance   NUMERIC;
  v_new_interest  NUMERIC;
  v_pending_id    UUID;
BEGIN
  -- Validação básica
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.';
  END IF;

  IF p_destination NOT IN ('principal_reduction', 'penalty_payment', 'general_credit') THEN
    RAISE EXCEPTION 'Destino inválido: %. Use principal_reduction, penalty_payment ou general_credit.', p_destination;
  END IF;

  SELECT * INTO v_inv FROM public.investments
  WHERE id = p_investment_id AND tenant_id = v_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF v_inv.status = 'completed' THEN
    RAISE EXCEPTION 'Contrato já está quitado.';
  END IF;

  -- Registrar em avulso_payments
  INSERT INTO public.avulso_payments (investment_id, tenant_id, company_id, amount, paid_at, notes)
  VALUES (p_investment_id, v_tenant_id, v_inv.company_id, p_amount, p_paid_at, p_notes)
  RETURNING id INTO v_avulso_id;

  -- ── Lógica específica por destino ────────────────────────────────────────

  IF p_destination = 'principal_reduction' AND v_inv.calculation_mode = 'interest_only' THEN
    -- Para bullet: reduzir remaining_balance e recalcular parcela pending
    v_new_balance := GREATEST(0, COALESCE(v_inv.remaining_balance, v_inv.amount_invested) - p_amount);

    UPDATE public.investments
    SET remaining_balance = v_new_balance,
        status = CASE WHEN v_new_balance = 0 THEN 'completed' ELSE status END,
        updated_at = NOW()
    WHERE id = p_investment_id;

    -- Recalcular parcela pending se existir
    SELECT id INTO v_pending_id
    FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
    ORDER BY number DESC LIMIT 1;

    IF v_pending_id IS NOT NULL THEN
      IF v_new_balance = 0 THEN
        -- Quitação total: marcar parcela como paga
        UPDATE public.loan_installments SET
          amount_principal = 0,
          amount_interest = 0,
          amount_total = 0,
          amount_paid = 0,
          status = 'paid',
          paid_at = p_paid_at,
          updated_at = NOW()
        WHERE id = v_pending_id;
      ELSE
        -- Recalcular com novo saldo
        v_new_interest := ROUND(v_new_balance * (v_inv.interest_rate / 100), 2);
        UPDATE public.loan_installments SET
          amount_principal = v_new_balance,
          amount_interest = v_new_interest,
          amount_total = v_new_balance + v_new_interest,
          updated_at = NOW()
        WHERE id = v_pending_id;
      END IF;
    END IF;

    v_applied := jsonb_build_object(
      'type', 'principal_reduction',
      'old_balance', COALESCE(v_inv.remaining_balance, v_inv.amount_invested),
      'new_balance', v_new_balance,
      'amount_applied', p_amount
    );

  ELSE
    -- Para non-bullet OU general_credit/penalty_payment:
    -- Aplicar em parcelas abertas (last-first para general_credit/penalty_payment)
    FOR v_inst IN
      SELECT id, number, amount_total, amount_paid, fine_amount, interest_delay_amount
      FROM public.loan_installments
      WHERE investment_id = p_investment_id
        AND tenant_id = v_tenant_id
        AND status != 'paid'
      ORDER BY due_date DESC, number DESC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_outstanding := GREATEST(0,
        (v_inst.amount_total + COALESCE(v_inst.fine_amount, 0) + COALESCE(v_inst.interest_delay_amount, 0))
        - COALESCE(v_inst.amount_paid, 0)
      );
      CONTINUE WHEN v_outstanding <= 0;

      IF v_remaining >= v_outstanding THEN
        UPDATE public.loan_installments
        SET amount_paid = v_inst.amount_total, status = 'paid',
            paid_at = p_paid_at, updated_at = NOW()
        WHERE id = v_inst.id;
        v_applied := v_applied || jsonb_build_object(
          'number', v_inst.number, 'amount_applied', v_outstanding, 'status', 'paid'
        );
        v_remaining := v_remaining - v_outstanding;
      ELSE
        UPDATE public.loan_installments
        SET amount_paid = COALESCE(amount_paid, 0) + v_remaining,
            status = 'partial', updated_at = NOW()
        WHERE id = v_inst.id;
        v_applied := v_applied || jsonb_build_object(
          'number', v_inst.number, 'amount_applied', v_remaining, 'status', 'partial'
        );
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  -- ── Audit trail obrigatório (BR-PAG-009) ─────────────────────────────────
  INSERT INTO public.payment_transactions (
    investment_id,
    installment_id,
    tenant_id,
    transaction_type,
    amount,
    principal_portion,
    interest_portion,
    notes,
    created_at
  ) VALUES (
    p_investment_id,
    -- Para avulso sem parcela vinculada, referenciar a última parcela pending/paid
    COALESCE(
      v_pending_id,
      (SELECT id FROM public.loan_installments
       WHERE investment_id = p_investment_id
       ORDER BY number DESC LIMIT 1)
    ),
    v_tenant_id,
    'avulso',
    p_amount,
    CASE WHEN p_destination = 'principal_reduction' THEN p_amount ELSE 0 END,
    0,
    p_notes,
    p_paid_at
  );

  RETURN jsonb_build_object(
    'avulso_id',      v_avulso_id,
    'amount',         p_amount,
    'destination',    p_destination,
    'amount_surplus', v_remaining,
    'installments',   v_applied
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_avulso(BIGINT, NUMERIC, TIMESTAMPTZ, TEXT, TEXT)
  TO authenticated, service_role;

-- ============================================================================
-- C) create_investment_validated: respeitar p_start_date para contratos mensais
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
    -- Se p_start_date foi fornecido, usá-lo diretamente (respeita escolha do admin)
    IF p_start_date IS NOT NULL THEN
      v_due_date := p_start_date;
    ELSIF p_frequency = 'monthly' THEN
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
      p_amount_invested, v_interest_per_period, p_amount_invested + v_interest_per_period, 'pending'
    );

    RETURN v_investment_id;
  END IF;

  -- Lógica original para contratos não-bullet
  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest  := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);

  IF p_frequency = 'monthly' THEN
    -- Se p_start_date foi fornecido, usá-lo como data base
    IF p_start_date IS NOT NULL THEN
      v_base_date := p_start_date;
    ELSE
      v_effective_day := COALESCE(p_due_day, 1);
      IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      ELSE
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      END IF;
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
    ELSIF p_frequency = 'daily' THEN
      v_candidate := COALESCE(p_start_date, CURRENT_DATE) + ((i - 1) || ' days')::INTERVAL;
      IF p_skip_saturday OR p_skip_sunday THEN
        v_bd_count := 0;
        v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE v_bd_count < i LOOP
          IF NOT ((p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0) OR
                  (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)) THEN
            v_bd_count := v_bd_count + 1;
          END IF;
          IF v_bd_count < i THEN
            v_candidate := v_candidate + INTERVAL '1 day';
          END IF;
        END LOOP;
        v_due_date := v_candidate;
      ELSE
        v_due_date := COALESCE(p_start_date, CURRENT_DATE) + ((i - 1) || ' days')::INTERVAL;
      END IF;
    ELSE
      v_due_date := CURRENT_DATE;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id, tenant_id, company_id, number, due_date,
      amount_principal, amount_interest, amount_total, status
    ) VALUES (
      v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
      v_amount_principal, v_amount_interest,
      ROUND(v_amount_principal + v_amount_interest, 2), 'pending'
    );
  END LOOP;

  RETURN v_investment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_investment_validated(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,TEXT,INTEGER,INTEGER,DATE,TEXT,BOOLEAN,BOOLEAN,DATE[],UUID,TEXT,BOOLEAN)
  TO authenticated, service_role;

-- ============================================================================
-- Verificação final
-- ============================================================================
SELECT
  'pay_avulso' as funcao,
  CASE WHEN COUNT(*) = 1 THEN 'OK — 1 overload' ELSE 'ERRO — overloads: ' || COUNT(*)::text END as status
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'pay_avulso'
UNION ALL
SELECT
  'generate_next_bullet_installment',
  CASE WHEN COUNT(*) = 1 THEN 'OK — 1 overload' ELSE 'ERRO — overloads: ' || COUNT(*)::text END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'generate_next_bullet_installment'
UNION ALL
SELECT
  'create_investment_validated',
  CASE WHEN COUNT(*) = 1 THEN 'OK — 1 overload' ELSE 'ERRO — overloads: ' || COUNT(*)::text END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_investment_validated';
