-- ============================================================================
-- Migration v49 — guardas de renovação em create_investment_validated
-- ============================================================================
-- Decisões do usuário (2026-08-10), sobre o mapa de renovação:
--
--   1. Só contrato QUITADO ('completed') pode ser renovado.
--      Renovar contrato 'active' deixava as parcelas em aberto do pai vivas e
--      cobráveis (cron de atraso marcava 'late' e gravava multa em bullet; o bot
--      somava a dívida do pai junto com a do filho) e contava o capital duas
--      vezes em view_investor_balances, porque o principal do pai nunca voltou
--      ao caixa. Rolagem de saldo devedor é um fato financeiro distinto e não
--      está implementada — então o caminho fica fechado em vez de errado.
--      'defaulted' e 'renewed' já eram rejeitados; agora a regra é uma só.
--
--   2. frequency='freelancer' exige datas suficientes.
--      Com p_custom_dates vazio, array_length() retorna NULL, o loop caía no
--      ELSE final e gravava TODAS as parcelas vencendo em CURRENT_DATE, sem
--      erro. A guarda fica no RPC (e não só no wizard) para valer para qualquer
--      chamador. Bullet gera 1 parcela; parcelado gera p_total_installments.
--
-- Assinatura NÃO muda — CREATE OR REPLACE basta, sem DROP e sem overload.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_investment_validated(
  p_tenant_id uuid, p_user_id uuid, p_payer_id uuid, p_asset_name text,
  p_amount_invested numeric, p_source_capital numeric DEFAULT 0, p_source_profit numeric DEFAULT 0,
  p_current_value numeric DEFAULT 0, p_interest_rate numeric DEFAULT 0,
  p_installment_value numeric DEFAULT 0, p_total_installments integer DEFAULT 1,
  p_frequency text DEFAULT 'monthly'::text, p_due_day integer DEFAULT NULL::integer,
  p_weekday integer DEFAULT NULL::integer, p_start_date date DEFAULT NULL::date,
  p_calculation_mode text DEFAULT 'manual'::text, p_skip_saturday boolean DEFAULT false,
  p_skip_sunday boolean DEFAULT false, p_custom_dates date[] DEFAULT NULL::date[],
  p_company_id uuid DEFAULT NULL::uuid, p_bullet_principal_mode text DEFAULT NULL::text,
  p_capitalize_interest boolean DEFAULT true, p_break_fee_percent numeric DEFAULT NULL::numeric,
  p_default_after_days integer DEFAULT 20, p_late_fine_percent numeric DEFAULT NULL::numeric,
  p_parent_investment_id bigint DEFAULT NULL::bigint
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
  v_parent_status TEXT;
  v_dates_needed INTEGER;
  v_total_base NUMERIC; v_p NUMERIC; v_t NUMERIC;
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

  -- v49: freelancer sem datas suficientes gravava tudo vencendo hoje, em silêncio.
  IF p_frequency = 'freelancer' THEN
    v_dates_needed := CASE WHEN p_calculation_mode = 'interest_only' THEN 1 ELSE p_total_installments END;
    IF COALESCE(array_length(p_custom_dates, 1), 0) < v_dates_needed THEN
      RAISE EXCEPTION 'Frequência freelancer exige % data(s) de vencimento (recebidas: %).',
        v_dates_needed, COALESCE(array_length(p_custom_dates, 1), 0);
    END IF;
  END IF;

  -- BR-CNT-007: renovação exige contrato de origem QUITADO. FOR UPDATE evita
  -- corrida entre a leitura do status e a criação do filho.
  IF p_parent_investment_id IS NOT NULL THEN
    SELECT status INTO v_parent_status
      FROM public.investments
     WHERE id = p_parent_investment_id AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contrato de origem % não encontrado neste tenant.', p_parent_investment_id;
    END IF;
    IF v_parent_status <> 'completed' THEN
      RAISE EXCEPTION 'Só contrato quitado pode ser renovado — o contrato % está %.',
        p_parent_investment_id,
        CASE v_parent_status
          WHEN 'active'    THEN 'em aberto (quite as parcelas restantes antes)'
          WHEN 'defaulted' THEN 'inadimplente (reverta o status antes)'
          WHEN 'renewed'   THEN 'já renovado'
          ELSE v_parent_status
        END;
    END IF;
  END IF;

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
    include_saturday, include_sunday, parent_investment_id
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
    NOT COALESCE(p_skip_sunday, false),
    p_parent_investment_id
  ) RETURNING id INTO v_investment_id;

  -- v49: o pai é sempre 'completed' aqui (validado acima) e PERMANECE 'completed'
  -- — BR-CNT-009 não permite completed -> renewed. Nenhuma transição de status.
  IF p_parent_investment_id IS NOT NULL THEN
    PERFORM public.log_audit_event(
      p_tenant_id, 'contract_renewed', 'rpc', auth.uid(), v_target_company_id, v_investment_id, NULL, NULL,
      v_correlation, NULL,
      jsonb_build_object('parent_investment_id', p_parent_investment_id, 'parent_status_before', v_parent_status),
      jsonb_build_object('child_investment_id', v_investment_id, 'parent_status_after', v_parent_status),
      NULL, NULL, NULL
    );
  END IF;

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
        v_days_ahead := ((COALESCE(p_weekday, 1) - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 7) % 7);
        IF v_days_ahead = 0 THEN v_days_ahead := 7; END IF;
        v_due_date := (CURRENT_DATE + (v_days_ahead || ' days')::INTERVAL)::DATE;
      END IF;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= 1 THEN
      v_due_date := p_custom_dates[1];
    ELSE
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
  -- v48: distribui PRINCIPAL e TOTAL; o juros e derivado (total - principal).
  v_total_base       := ROUND(p_current_value / NULLIF(p_total_installments, 0), 2);
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
    -- v48: residuo da divisao vai para a ULTIMA parcela (mesma convencao do
    -- distributeEvenly que a edicao usa), para a soma fechar com o contrato.
    IF i < p_total_installments THEN
      v_p := v_amount_principal; v_t := v_total_base;
    ELSE
      v_p := ROUND(p_amount_invested - v_amount_principal * (p_total_installments - 1), 2);
      v_t := ROUND(p_current_value   - v_total_base       * (p_total_installments - 1), 2);
    END IF;
    v_amount_interest := ROUND(v_t - v_p, 2);

    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date, v_p, v_amount_interest, v_t, 'pending');
  END LOOP;
  RETURN v_investment_id;
END;
$function$;
