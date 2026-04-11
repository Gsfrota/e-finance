-- ============================================================
-- Migration v41: Fechamento automático de contratos + correção avulso
-- BR-CNT-011 | BR-REL-016 | BR-PAG-023 (fix)
-- Data: 2026-04-11
-- ============================================================

-- ── 1. Função auxiliar: recalculate_investment_status ────────────────────────
-- Avalia se o contrato deve ser fechado (completed) ou reaberto (active)
-- após qualquer mutação financeira. Idempotente — pode ser chamada várias vezes.
-- Regras:
--   • auto/manual: fecha quando todas as parcelas reais (amount_total > 0) são 'paid'
--     E remaining_balance IS NULL OR remaining_balance < 0.01
--   • interest_only (bullet/revolving): fecha APENAS quando remaining_balance < 0.01
--   • defaulted/renewed: não são alterados automaticamente
--   • Inverso: se contrato estava 'completed' mas agora tem parcela não-paga, volta para 'active'
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recalculate_investment_status(p_investment_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv investments%ROWTYPE;
  v_has_open_installment BOOLEAN;
  v_should_complete BOOLEAN := false;
  v_should_reopen   BOOLEAN := false;
BEGIN
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Não alterar contratos defaulted ou renewed automaticamente
  IF v_inv.status IN ('defaulted', 'renewed') THEN RETURN; END IF;

  -- Verificar se existe alguma parcela real (não-absorvida) ainda em aberto
  SELECT EXISTS (
    SELECT 1 FROM loan_installments
    WHERE investment_id = p_investment_id
      AND status NOT IN ('paid')
      AND amount_total > 0
  ) INTO v_has_open_installment;

  -- ── Lógica por calculation_mode ─────────────────────────────────────────
  IF v_inv.calculation_mode IN ('auto', 'manual') THEN
    -- Fecha: sem parcelas em aberto E saldo nulo ou zerado
    v_should_complete := NOT v_has_open_installment
      AND (v_inv.remaining_balance IS NULL OR v_inv.remaining_balance < 0.01);

    -- Reabre: contrato estava completed mas tem parcela em aberto (ex: revert)
    v_should_reopen := v_inv.status = 'completed' AND v_has_open_installment;

  ELSIF v_inv.calculation_mode = 'interest_only' THEN
    -- Bullet/revolving: fecha APENAS quando remaining_balance zerado
    -- (pode ter todas parcelas pagas mas saldo > 0 → contrato rotativo ainda ativo)
    v_should_complete := v_inv.remaining_balance IS NOT NULL
      AND v_inv.remaining_balance < 0.01;

    v_should_reopen := v_inv.status = 'completed'
      AND (v_inv.remaining_balance IS NULL OR v_inv.remaining_balance >= 0.01);
  END IF;

  -- ── Aplicar transição ───────────────────────────────────────────────────
  IF v_should_complete AND v_inv.status != 'completed' THEN
    UPDATE investments
    SET status = 'completed', updated_at = NOW()
    WHERE id = p_investment_id;

  ELSIF v_should_reopen THEN
    UPDATE investments
    SET status = 'active', updated_at = NOW()
    WHERE id = p_investment_id;
  END IF;
END;
$$;


-- ── 2. Corrigir pay_avulso: installment_id = NULL + destination em notes ─────
-- Problemas na versão anterior (v40):
--   A) installment_id usava COALESCE(v_pending_id, última parcela) → violava BR-PAG-023
--   B) destination não era gravado em notes → InstallmentHistory não conseguia exibir
--   C) recalculate_investment_status não era chamado em todos os caminhos
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pay_avulso(
  p_investment_id bigint,
  p_amount numeric,
  p_paid_at timestamp with time zone DEFAULT now(),
  p_notes text DEFAULT NULL::text,
  p_destination text DEFAULT 'general_credit'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
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
  v_tx_notes      TEXT;
BEGIN
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

  -- Montar notes para payment_transactions incluindo destino (BR-REL-016)
  v_tx_notes := COALESCE(p_notes || ' | ', '') || 'destino:' || p_destination;

  -- Registrar em avulso_payments
  INSERT INTO public.avulso_payments (investment_id, tenant_id, company_id, amount, paid_at, notes)
  VALUES (p_investment_id, v_tenant_id, v_inv.company_id, p_amount, p_paid_at, p_notes)
  RETURNING id INTO v_avulso_id;

  -- ── Lógica por destino ────────────────────────────────────────────────────

  IF p_destination = 'principal_reduction' AND v_inv.calculation_mode = 'interest_only' THEN
    v_new_balance := GREATEST(0, COALESCE(v_inv.remaining_balance, v_inv.amount_invested) - p_amount);

    UPDATE public.investments
    SET remaining_balance = v_new_balance,
        updated_at = NOW()
    WHERE id = p_investment_id;

    SELECT id INTO v_pending_id
    FROM public.loan_installments
    WHERE investment_id = p_investment_id AND status = 'pending'
    ORDER BY number DESC LIMIT 1;

    IF v_pending_id IS NOT NULL THEN
      IF v_new_balance = 0 THEN
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
    -- general_credit ou penalty_payment: quita parcelas pendentes last-first
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

  -- ── Gravar em payment_transactions (BR-PAG-014, BR-PAG-023) ──────────────
  -- installment_id = NULL: avulso é vínculo de contrato, não de parcela (BR-PAG-023)
  INSERT INTO public.payment_transactions (
    investment_id, installment_id, tenant_id,
    transaction_type, amount, principal_portion, interest_portion,
    notes, created_at
  ) VALUES (
    p_investment_id,
    NULL,   -- BR-PAG-023: avulso é nível contrato
    v_tenant_id,
    'avulso',
    p_amount,
    CASE WHEN p_destination = 'principal_reduction' THEN p_amount ELSE 0 END,
    0,
    v_tx_notes,
    p_paid_at
  );

  -- ── Avaliar fechamento do contrato (BR-CNT-011) ───────────────────────────
  PERFORM recalculate_investment_status(p_investment_id);

  RETURN jsonb_build_object(
    'avulso_id',      v_avulso_id,
    'amount',         p_amount,
    'destination',    p_destination,
    'amount_surplus', v_remaining,
    'installments',   v_applied
  );
END;
$$;


-- ── 3. Adicionar recalculate_investment_status em pay_installment ─────────────

CREATE OR REPLACE FUNCTION public.pay_installment(
  p_installment_id uuid,
  p_amount_paid numeric,
  p_paid_at timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inst loan_installments%ROWTYPE;
  v_outstanding NUMERIC;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  v_outstanding := GREATEST(0, (v_inst.amount_total + v_inst.fine_amount + v_inst.interest_delay_amount) - v_inst.amount_paid);

  IF v_outstanding <= 0.01 THEN
    RAISE EXCEPTION 'Esta parcela já está quitada.';
  END IF;

  IF p_amount_paid <= 0 THEN RAISE EXCEPTION 'Valor deve ser positivo'; END IF;

  IF p_amount_paid > v_outstanding + 0.01 THEN
    p_amount_paid := v_outstanding;
  END IF;

  UPDATE loan_installments SET
    amount_paid = amount_paid + p_amount_paid,
    status = CASE
      WHEN (amount_paid + p_amount_paid) >= (amount_total + fine_amount + interest_delay_amount) THEN 'paid'
      ELSE 'partial'
    END,
    paid_at = CASE
      WHEN (amount_paid + p_amount_paid) >= (amount_total + fine_amount + interest_delay_amount) THEN p_paid_at
      ELSE paid_at
    END,
    updated_at = NOW()
  WHERE id = p_installment_id;

  -- BR-CNT-011: verificar fechamento do contrato
  PERFORM recalculate_investment_status(v_inst.investment_id);
END;
$$;


-- ── 4. Adicionar recalculate_investment_status em apply_surplus_action ────────
-- (apenas o bloco final — função preservada integralmente com adição no final)

CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id uuid,
  p_surplus_amount numeric,
  p_action text,
  p_paid_at timestamp with time zone DEFAULT now()
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_src               RECORD;
  v_inst              RECORD;
  v_outstanding       NUMERIC;
  v_remaining         NUMERIC := p_surplus_amount;
  v_total_outstanding NUMERIC;
  v_share             NUMERIC;
BEGIN
  SELECT * INTO v_src FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  -- ── 'next': ordem crescente, até esgotar ────────────────────────────────
  IF p_action = 'next' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status      = 'paid',
            paid_at     = p_paid_at,
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        UPDATE loan_installments
        SET amount_paid = COALESCE(amount_paid, 0) + v_remaining,
            status      = 'partial',
            notes       = 'Pgto parcial (' || round(v_remaining, 2)::text
                          || ') via excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;

  -- ── 'last': ordem decrescente, até esgotar ──────────────────────────────
  ELSIF p_action = 'last' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number DESC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status      = 'paid',
            paid_at     = p_paid_at,
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        UPDATE loan_installments
        SET amount_paid = COALESCE(amount_paid, 0) + v_remaining,
            status      = 'partial',
            notes       = 'Pgto parcial (' || round(v_remaining, 2)::text
                          || ') via excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;

  -- ── 'spread': distribuição proporcional ────────────────────────────────
  ELSIF p_action = 'spread' THEN
    SELECT COALESCE(SUM(
      GREATEST(0,
        amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0)
        - COALESCE(amount_paid, 0))
    ), 0)
    INTO v_total_outstanding
    FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id;

    IF v_total_outstanding <= 0.01 THEN
      RETURN v_remaining;
    END IF;

    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_outstanding <= 0.01 THEN CONTINUE; END IF;

      v_share := LEAST(
        v_outstanding,
        v_remaining,
        ROUND(p_surplus_amount * (v_outstanding / v_total_outstanding), 2)
      );

      IF v_share <= 0.01 THEN CONTINUE; END IF;

      IF v_share >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status      = 'paid',
            paid_at     = p_paid_at,
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
      ELSE
        UPDATE loan_installments
        SET amount_paid = COALESCE(amount_paid, 0) + v_share,
            status      = 'partial',
            notes       = 'Pgto parcial (' || round(v_share, 2)::text
                          || ') via excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
      END IF;
      v_remaining := v_remaining - v_share;
    END LOOP;
  END IF;

  -- BR-CNT-011: verificar fechamento do contrato
  PERFORM recalculate_investment_status(v_src.investment_id);

  RETURN GREATEST(0, v_remaining);
END;
$$;


-- ── 5. Adicionar recalculate_investment_status em revert_installment_payment ──
-- (reabre contrato se estava completed e agora tem parcela em aberto)

CREATE OR REPLACE FUNCTION public.revert_installment_payment(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inst loan_installments%ROWTYPE;
  v_reverted_amount NUMERIC;
  v_surplus_amount NUMERIC;
  v_per_target NUMERIC;
  v_target_count INT;
  v_target RECORD;
  v_reverted_count INT := 0;
  v_details TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF COALESCE(v_inst.amount_paid, 0) <= 0 THEN
    RAISE EXCEPTION 'Parcela não possui pagamento para reverter';
  END IF;

  v_reverted_amount := v_inst.amount_paid;

  -- ── 1. Revert surplus_received on other installments ────────────────────
  FOR v_target IN
    SELECT pt.installment_id, pt.amount
    FROM payment_transactions pt
    WHERE pt.related_installment_id = p_installment_id
      AND pt.transaction_type = 'surplus_received'
  LOOP
    UPDATE loan_installments li SET
      amount_paid = GREATEST(0, li.amount_paid - v_target.amount),
      status = CASE
        WHEN GREATEST(0, li.amount_paid - v_target.amount) >= (li.amount_total + COALESCE(li.fine_amount,0) + COALESCE(li.interest_delay_amount,0) - 0.01) THEN 'paid'
        WHEN GREATEST(0, li.amount_paid - v_target.amount) > 0.01 THEN 'partial'
        WHEN li.due_date < CURRENT_DATE THEN 'late'
        ELSE 'pending'
      END,
      paid_at = CASE
        WHEN GREATEST(0, li.amount_paid - v_target.amount) >= (li.amount_total + COALESCE(li.fine_amount,0) + COALESCE(li.interest_delay_amount,0) - 0.01) THEN li.paid_at
        ELSE NULL
      END,
      notes = NULL,
      updated_at = NOW()
    WHERE li.id = v_target.installment_id;
    v_reverted_count := v_reverted_count + 1;
    v_details := array_append(v_details, 'surplus_received revertido na parcela ' || v_target.installment_id::text);
  END LOOP;

  -- ── 2. Revert surplus discount on targets ───────────────────────────────
  SELECT COALESCE(SUM(pt.amount), 0) INTO v_surplus_amount
  FROM payment_transactions pt
  WHERE pt.installment_id = p_installment_id
    AND pt.transaction_type = 'surplus_applied';

  IF v_surplus_amount > 0 THEN
    SELECT COUNT(*) INTO v_target_count
    FROM loan_installments li
    WHERE li.investment_id = v_inst.investment_id
      AND li.id != p_installment_id
      AND li.notes LIKE '%excedente da parcela #' || v_inst.number || '%';

    v_per_target := v_surplus_amount / GREATEST(v_target_count, 1);

    FOR v_target IN
      SELECT li.*
      FROM loan_installments li
      WHERE li.investment_id = v_inst.investment_id
        AND li.id != p_installment_id
        AND li.notes LIKE '%excedente da parcela #' || v_inst.number || '%'
      FOR UPDATE
    LOOP
      IF v_target.status = 'paid' AND v_target.notes LIKE 'Quitada com excedente%' THEN
        UPDATE loan_installments SET
          amount_paid = GREATEST(0, amount_paid - v_per_target),
          status = CASE
            WHEN GREATEST(0, amount_paid - v_per_target) >= (amount_total + COALESCE(fine_amount,0) + COALESCE(interest_delay_amount,0) - 0.01) THEN 'paid'
            WHEN GREATEST(0, amount_paid - v_per_target) > 0.01 THEN 'partial'
            WHEN due_date < CURRENT_DATE THEN 'late'
            ELSE 'pending'
          END,
          paid_at = CASE
            WHEN GREATEST(0, amount_paid - v_per_target) >= (amount_total + COALESCE(fine_amount,0) + COALESCE(interest_delay_amount,0) - 0.01) THEN paid_at
            ELSE NULL
          END,
          notes = NULL,
          updated_at = NOW()
        WHERE id = v_target.id;
      ELSE
        UPDATE loan_installments SET
          amount_total = amount_total + v_per_target,
          notes = NULL,
          updated_at = NOW()
        WHERE id = v_target.id;
      END IF;
      v_reverted_count := v_reverted_count + 1;
      v_details := array_append(v_details, 'surplus revertido na parcela #' || v_target.number);
    END LOOP;
  END IF;

  -- ── 3. Revert deferred installments ────────────────────────────────────
  FOR v_target IN
    SELECT li.*
    FROM loan_installments li
    WHERE li.deferred_from_id = p_installment_id
    FOR UPDATE
  LOOP
    IF v_target.status IN ('pending', 'late') AND COALESCE(v_target.amount_paid, 0) <= 0.01 THEN
      DELETE FROM loan_installments WHERE id = v_target.id;
      UPDATE investments SET total_installments = GREATEST(1, total_installments - 1)
      WHERE id = v_inst.investment_id;
      v_details := array_append(v_details, 'parcela diferida #' || v_target.number || ' removida');
    ELSE
      UPDATE loan_installments SET deferred_from_id = NULL, updated_at = NOW()
      WHERE id = v_target.id;
      v_details := array_append(v_details, 'link de deferimento removido da parcela #' || v_target.number);
    END IF;
    v_reverted_count := v_reverted_count + 1;
  END LOOP;

  -- ── 4. Reset current installment ──────────────────────────────────────
  UPDATE loan_installments SET
    amount_paid = 0,
    status = CASE WHEN due_date < CURRENT_DATE THEN 'late' ELSE 'pending' END,
    paid_at = NULL,
    notes = NULL,
    updated_at = NOW()
  WHERE id = p_installment_id;

  -- ── 5. Log reversal ──────────────────────────────────────────────────
  INSERT INTO payment_transactions
    (tenant_id, investment_id, installment_id, transaction_type, amount, notes)
  VALUES
    (v_inst.tenant_id, v_inst.investment_id, p_installment_id, 'reversal', v_reverted_amount,
     'Reversão completa: R$' || ROUND(v_reverted_amount, 2) || ' + ' || v_reverted_count || ' op. relacionadas: ' || array_to_string(v_details, '; '));

  -- BR-CNT-011: reavaliar status (pode reabrir contrato)
  PERFORM recalculate_investment_status(v_inst.investment_id);

  RETURN jsonb_build_object(
    'reverted_amount', v_reverted_amount,
    'related_operations_reverted', v_reverted_count,
    'details', to_jsonb(v_details)
  );
END;
$$;


-- ── 6. Backfill: inserir payment_transactions para 2 avulsos órfãos ──────────
-- Diagnóstico: investment_ids 513 e 101 têm avulso_payments mas sem TX correspondente.
-- Esses avulsos foram feitos em março/2026 antes da v40.
-- installment_id = NULL conforme BR-PAG-023.

INSERT INTO public.payment_transactions (
  investment_id, installment_id, tenant_id,
  transaction_type, amount, principal_portion, interest_portion,
  notes, created_at
)
SELECT
  ap.investment_id,
  NULL,   -- BR-PAG-023: avulso é nível contrato
  ap.tenant_id,
  'avulso',
  ap.amount,
  0,
  0,
  COALESCE(ap.notes, '') || ' | destino:general_credit [backfill v41]',
  ap.paid_at
FROM avulso_payments ap
WHERE ap.investment_id IN (513, 101)
  AND NOT EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE pt.investment_id = ap.investment_id
      AND pt.transaction_type = 'avulso'
  );


-- ── 7. Backfill: fechar contratos auto/manual já quitados ────────────────────
-- 25 contratos com calculation_mode IN ('auto','manual'), status='active',
-- todas as parcelas pagas e remaining_balance IS NULL ou < 0.01.
-- NÃO toca em interest_only com remaining_balance > 0 (revolving ativo).

UPDATE public.investments
SET status = 'completed', updated_at = NOW()
WHERE status = 'active'
  AND calculation_mode IN ('auto', 'manual')
  AND (remaining_balance IS NULL OR remaining_balance < 0.01)
  AND NOT EXISTS (
    SELECT 1 FROM loan_installments li
    WHERE li.investment_id = investments.id
      AND li.status NOT IN ('paid')
      AND li.amount_total > 0
  );


-- ── 8. Validação pós-migração ─────────────────────────────────────────────────
-- Executar após aplicar para confirmar resultados esperados:
--
-- SELECT COUNT(*) FROM investments WHERE status = 'completed';
--   → deve mostrar N+25 (onde N = count anterior de completed)
--
-- SELECT COUNT(*) FROM payment_transactions WHERE transaction_type = 'avulso';
--   → deve ser 3 (era 1 + 2 backfill)
--
-- SELECT COUNT(*) FROM avulso_payments ap
--   WHERE NOT EXISTS (SELECT 1 FROM payment_transactions pt
--     WHERE pt.investment_id = ap.investment_id AND pt.transaction_type = 'avulso');
--   → deve ser 0
