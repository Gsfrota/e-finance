-- =================================================================
-- V35: Fix apply_surplus_action — 5 bugs corrigidos
-- Aplicado em: 2026-03-26
--
-- P1 (CRITICAL): outstanding excluía fine/delay → divergência com frontend
--   Fix: v_outstanding inclui fine_amount + interest_delay_amount
--
-- P2 (HIGH): surplus parcial reduzia amount_total em vez de amount_paid
--   Fix: ELSE branch aumenta amount_paid e seta status='partial'
--        amount_total permanece intacto (termos originais preservados)
--
-- P3 (MEDIUM): 'spread' era sequencial (= cópia do 'next'), não proporcional
--   Fix: algoritmo 2 passes — soma outstanding total, distribui por cota
--
-- P4 (MEDIUM): paid_at = NOW() ignorava data escolhida pelo usuário
--   Fix: novo parâmetro p_paid_at TIMESTAMPTZ DEFAULT NOW()
--        frontend passa paidAtTs nos 3 call sites
--
-- P5 (MEDIUM): surplus descartado silenciosamente sem parcelas elegíveis
--   Fix: RETURNS NUMERIC (sobra); frontend loga warning se > 0.01
-- =================================================================

-- DROP necessário pois return type muda de VOID para NUMERIC
DROP FUNCTION IF EXISTS public.apply_surplus_action(UUID, NUMERIC, TEXT);

CREATE FUNCTION public.apply_surplus_action(
  p_installment_id UUID,
  p_surplus_amount  NUMERIC,
  p_action          TEXT,                       -- 'next' | 'last' | 'spread'
  p_paid_at         TIMESTAMPTZ DEFAULT NOW()  -- FIX P4: data real do pagamento
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
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
      -- FIX P1: inclui fine_amount e interest_delay_amount
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_remaining >= v_outstanding - 0.01 THEN
        -- Quita completamente
        UPDATE loan_installments
        SET amount_paid = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status      = 'paid',
            paid_at     = p_paid_at,            -- FIX P4
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        -- FIX P2: registra pagamento parcial; NÃO altera amount_total
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
      -- FIX P1
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status      = 'paid',
            paid_at     = p_paid_at,            -- FIX P4
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        -- FIX P2
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

  -- ── 'spread': distribuição proporcional real (FIX P3) ───────────────────
  ELSIF p_action = 'spread' THEN
    -- Passo 1: soma o outstanding total elegível (FIX P1 incluso)
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

    -- FIX P5: sem destino → retorna tudo imediatamente
    IF v_total_outstanding <= 0.01 THEN
      RETURN v_remaining;
    END IF;

    -- Passo 2: aplica cota proporcional em cada parcela
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      -- FIX P1
      v_outstanding := GREATEST(0,
        v_inst.amount_total + COALESCE(v_inst.fine_amount, 0)
        + COALESCE(v_inst.interest_delay_amount, 0) - COALESCE(v_inst.amount_paid, 0));

      IF v_outstanding <= 0.01 THEN CONTINUE; END IF;

      -- Cota proporcional: limitada ao outstanding e ao que ainda resta
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
            paid_at     = p_paid_at,            -- FIX P4
            notes       = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at  = NOW()
        WHERE id = v_inst.id;
      ELSE
        -- FIX P2
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

  -- FIX P5: retorna o que sobrou (idealmente 0; > 0 indica gap)
  RETURN GREATEST(0, v_remaining);
END;
$$;
