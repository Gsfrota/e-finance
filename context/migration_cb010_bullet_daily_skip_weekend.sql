-- ============================================================================
-- Migration CB-010 — Pular Sábado/Domingo no bullet diário
-- ============================================================================
-- Data: 2026-05-29
-- Story: docs/stories/CB-010-bullet-daily-skip-weekend.story.md
--
-- Corrige 3 bugs em cascata na camada de banco (frontend já enviava as flags
-- p_skip_saturday/p_skip_sunday corretamente):
--
--   Bug 1 — create_investment_validated: a 1ª parcela bullet ignorava o skip.
--           A condição "IF p_start_date IS NOT NULL" era avaliada antes dos
--           ELSIF de frequência, e o frontend SEMPRE envia start_date no daily,
--           então o ramo com a lógica de skip nunca era alcançado.
--           Fix: bloco bullet reestruturado por frequência; o ramo daily aplica
--           o skip de fim de semana mesmo quando start_date é fornecido.
--
--   Bug 2 — create_investment_validated: o INSERT em investments omitia as
--           colunas include_saturday/include_sunday (default true no schema),
--           perdendo a preferência do usuário.
--           Fix: persistir include_saturday = NOT skip_saturday,
--                            include_sunday   = NOT skip_sunday.
--
--   Bug 3 — generate_next_bullet_installment (rollover): no daily somava
--           "+1 dia" sem checar fim de semana, gerando parcelas em sáb/dom.
--           Fix: após calcular v_next_due, no daily avança sobre os dias
--                bloqueados conforme include_saturday/include_sunday.
--
-- Hardening de segurança (advisor lint 0011 function_search_path_mutable):
--   create_investment_validated agora declara SET search_path TO 'public','auth'
--   (alinhado a generate_next_bullet_installment). Seguro: todas as referências
--   internas já são schema-qualificadas (public.*, auth.uid()).
--
-- Convenção DOW: EXTRACT(DOW) e JS getDay() => 0=Dom .. 6=Sáb (igual CB-009).
--
-- Validação (BEGIN/ROLLBACK em produção, banco intacto):
--   | Caso                                   | inc_sat | inc_sun | 1ª parcela | rollover |
--   | A: start sáb 30/05, skip ambos         | false   | false   | Seg 01/06  | —        |
--   | B: start sex 05/06, skip ambos         | false   | false   | Sex 05/06  | Seg 08/06|
--   | bullet mensal (não-regressão)          | true    | true    | 10/06      | —        |
--   | parcelado 3x mensal (não-regressão)    | true    | true    | 10/06..08  | —        |
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) create_investment_validated
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_investment_validated(
  p_tenant_id uuid, p_user_id uuid, p_payer_id uuid, p_asset_name text, p_amount_invested numeric,
  p_source_capital numeric DEFAULT 0, p_source_profit numeric DEFAULT 0, p_current_value numeric DEFAULT 0,
  p_interest_rate numeric DEFAULT 0, p_installment_value numeric DEFAULT 0, p_total_installments integer DEFAULT 1,
  p_frequency text DEFAULT 'monthly'::text, p_due_day integer DEFAULT NULL::integer, p_weekday integer DEFAULT NULL::integer,
  p_start_date date DEFAULT NULL::date, p_calculation_mode text DEFAULT 'manual'::text,
  p_skip_saturday boolean DEFAULT false, p_skip_sunday boolean DEFAULT false,
  p_custom_dates date[] DEFAULT NULL::date[], p_company_id uuid DEFAULT NULL::uuid,
  p_bullet_principal_mode text DEFAULT NULL::text, p_capitalize_interest boolean DEFAULT true,
  p_break_fee_percent numeric DEFAULT NULL::numeric, p_default_after_days integer DEFAULT 20,
  p_late_fine_percent numeric DEFAULT NULL::numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_investment_id BIGINT; v_amount_principal NUMERIC; v_amount_interest NUMERIC;
  v_installment_value_rounded NUMERIC; v_due_date DATE; v_base_date DATE; v_effective_day INTEGER;
  v_bd_count INTEGER; v_candidate DATE; v_target_company_id UUID; v_is_bullet BOOLEAN;
  v_interest_per_period NUMERIC; i INTEGER; v_correlation UUID := gen_random_uuid(); v_first_inst_id UUID;
  v_days_ahead INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_tenant_id_safe() IS NOT NULL AND p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;
  IF p_default_after_days IS NOT NULL AND p_default_after_days < 1 THEN
    RAISE EXCEPTION 'default_after_days deve ser >= 1 (recebido: %)', p_default_after_days; END IF;
  IF p_break_fee_percent IS NOT NULL AND (p_break_fee_percent < 0 OR p_break_fee_percent > 100) THEN
    RAISE EXCEPTION 'break_fee_percent deve estar entre 0 e 100 (recebido: %)', p_break_fee_percent; END IF;
  IF p_late_fine_percent IS NOT NULL AND (p_late_fine_percent < 0 OR p_late_fine_percent > 100) THEN
    RAISE EXCEPTION 'late_fine_percent deve estar entre 0 e 100 (recebido: %)', p_late_fine_percent; END IF;

  v_target_company_id := public.resolve_company_id_for_tenant(p_tenant_id, p_company_id, p_user_id, p_payer_id);
  v_is_bullet := (p_calculation_mode = 'interest_only');
  v_installment_value_rounded := ROUND(p_installment_value::numeric, 2);
  IF v_is_bullet THEN
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;
  END IF;

  INSERT INTO public.investments (
    tenant_id, company_id, user_id, payer_id, asset_name, amount_invested, current_value, interest_rate,
    installment_value, total_installments, frequency, due_day, weekday, start_date, calculation_mode,
    source_capital, source_profit, bullet_principal_mode, remaining_balance, capitalize_interest,
    break_fee_percent, default_after_days, late_fine_percent,
    include_saturday, include_sunday  -- CB-010 Bug 2: persistir preferência
  ) VALUES (
    p_tenant_id, v_target_company_id, p_user_id, p_payer_id, p_asset_name, p_amount_invested, p_current_value, p_interest_rate,
    v_installment_value_rounded,
    CASE WHEN v_is_bullet THEN NULL WHEN p_bullet_principal_mode = 'separate' THEN p_total_installments + 1 ELSE p_total_installments END,
    p_frequency, p_due_day, p_weekday, p_start_date, p_calculation_mode, p_source_capital, p_source_profit,
    CASE WHEN v_is_bullet THEN NULL ELSE p_bullet_principal_mode END,
    CASE WHEN v_is_bullet THEN p_amount_invested ELSE NULL END,
    CASE WHEN v_is_bullet THEN p_capitalize_interest ELSE TRUE END,
    CASE WHEN v_is_bullet THEN p_break_fee_percent ELSE NULL END,
    COALESCE(p_default_after_days, 20),
    CASE WHEN v_is_bullet THEN p_late_fine_percent ELSE NULL END,
    NOT COALESCE(p_skip_saturday, false),
    NOT COALESCE(p_skip_sunday, false)
  ) RETURNING id INTO v_investment_id;

  PERFORM public.log_audit_event(
    p_tenant_id, CASE WHEN v_is_bullet THEN 'bullet_contract_created' ELSE 'contract_created' END, 'rpc',
    auth.uid(), v_target_company_id, v_investment_id, NULL, NULL, v_correlation, NULL, NULL,
    jsonb_build_object('calculation_mode',p_calculation_mode,'amount_invested',p_amount_invested,'interest_rate',p_interest_rate,
                       'break_fee_percent',CASE WHEN v_is_bullet THEN p_break_fee_percent END,
                       'default_after_days',COALESCE(p_default_after_days,20),
                       'late_fine_percent',CASE WHEN v_is_bullet THEN p_late_fine_percent END),
    jsonb_build_object('amount_invested',p_amount_invested), NULL, NULL
  );

  IF v_is_bullet THEN
    -- CB-010 Bug 1: reestruturado por frequência (antes "IF p_start_date IS NOT NULL"
    -- no topo curto-circuitava o skip do daily).
    IF p_frequency = 'monthly' THEN
      IF p_start_date IS NOT NULL THEN v_due_date := p_start_date;
      ELSE
        v_effective_day := COALESCE(p_due_day, 1);
        IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
          v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
        ELSE v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE; END IF;
        v_due_date := LEAST(v_base_date, (DATE_TRUNC('month', v_base_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
      END IF;
    ELSIF p_frequency = 'weekly' THEN
      IF p_start_date IS NOT NULL THEN v_due_date := p_start_date;
      ELSE
        -- CB-009: próxima ocorrência do weekday desejado (0=Dom..6=Sáb).
        v_days_ahead := ((COALESCE(p_weekday, 1) - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 7) % 7);
        IF v_days_ahead = 0 THEN v_days_ahead := 7; END IF;
        v_due_date := (CURRENT_DATE + (v_days_ahead || ' days')::INTERVAL)::DATE;
      END IF;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= 1 THEN
      v_due_date := p_custom_dates[1];
    ELSE
      -- daily (CB-010): respeitar start_date E pular fins de semana bloqueados
      v_candidate := COALESCE(p_start_date, CURRENT_DATE);
      IF p_skip_saturday OR p_skip_sunday THEN
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0) OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day'; END LOOP;
      END IF;
      v_due_date := v_candidate;
    END IF;

    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, 1, v_due_date, p_amount_invested, v_interest_per_period, p_amount_invested + v_interest_per_period, 'pending')
    RETURNING id INTO v_first_inst_id;

    PERFORM public.log_audit_event(
      p_tenant_id, 'bullet_cycle_created', 'rpc', auth.uid(), v_target_company_id, v_investment_id, v_first_inst_id, NULL, v_correlation, NULL, NULL,
      jsonb_build_object('number',1,'due_date',v_due_date,'amount_interest',v_interest_per_period),
      jsonb_build_object('interest',v_interest_per_period,'principal',p_amount_invested), NULL, NULL
    );

    RETURN v_investment_id;
  END IF;

  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest  := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);
  IF p_frequency = 'monthly' THEN
    IF p_start_date IS NOT NULL THEN v_base_date := p_start_date;
    ELSE
      v_effective_day := COALESCE(p_due_day, 1);
      IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      ELSE v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE; END IF;
    END IF;
  END IF;
  FOR i IN 1..p_total_installments LOOP
    IF p_frequency = 'monthly' THEN
      v_due_date := (DATE_TRUNC('month', v_base_date + ((i-1) || ' months')::INTERVAL) + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day')::DATE;
      v_due_date := LEAST(v_due_date, (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF p_frequency = 'weekly' THEN v_due_date := (CURRENT_DATE + (i * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= i THEN v_due_date := p_custom_dates[i];
    ELSIF p_frequency = 'daily' THEN
      IF p_skip_saturday OR p_skip_sunday THEN
        v_bd_count := 0; v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE v_bd_count < i LOOP
          IF NOT ((p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0) OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)) THEN v_bd_count := v_bd_count + 1; END IF;
          IF v_bd_count < i THEN v_candidate := v_candidate + INTERVAL '1 day'; END IF;
        END LOOP;
        v_due_date := v_candidate;
      ELSE v_due_date := COALESCE(p_start_date, CURRENT_DATE) + ((i - 1) || ' days')::INTERVAL; END IF;
    ELSE v_due_date := CURRENT_DATE; END IF;
    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date, v_amount_principal, v_amount_interest, ROUND(v_amount_principal + v_amount_interest, 2), 'pending');
  END LOOP;
  RETURN v_investment_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) generate_next_bullet_installment (rollover)
-- ----------------------------------------------------------------------------
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

  IF EXISTS (
    SELECT 1 FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
  ) THEN
    SELECT id INTO v_new_id FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
    ORDER BY number DESC LIMIT 1;
    RETURN v_new_id;
  END IF;

  SELECT * INTO v_last_inst
  FROM public.loan_installments
  WHERE investment_id = p_investment_id
  ORDER BY number DESC LIMIT 1;

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

  -- CB-010 Bug 3: no daily, pular fins de semana bloqueados (include_saturday/include_sunday)
  IF v_inv.frequency = 'daily' THEN
    WHILE (NOT v_inv.include_sunday AND EXTRACT(DOW FROM v_next_due) = 0)
       OR (NOT v_inv.include_saturday AND EXTRACT(DOW FROM v_next_due) = 6) LOOP
      v_next_due := v_next_due + INTERVAL '1 day';
    END LOOP;
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
$function$;

-- ----------------------------------------------------------------------------
-- 3) Data fix — contrato de teste #3462 (criado durante diagnóstico CB-010)
--    Alinha o registro ao comportamento correto: skip de fim de semana ativo
--    e 1ª parcela movida de sáb 30/05 para seg 01/06.
--    Idempotente / sem efeito em outros tenants. Remover se reproduzir do zero.
-- ----------------------------------------------------------------------------
-- UPDATE public.investments
--   SET include_saturday = false, include_sunday = false, updated_at = NOW()
--   WHERE id = 3462;
-- UPDATE public.loan_installments
--   SET due_date = '2026-06-01', updated_at = NOW()
--   WHERE investment_id = 3462 AND number = 1;
