-- =================================================================
-- V43: Fix apply_surplus_action — regressão BUG-1 introduzida por V35
-- Aplicado em: 2026-04-14
--
-- PROBLEMA: V35 reescreveu a função preservando fixes P1-P5 mas
-- omitiu o filtro `AND number > v_src.number` que havia sido
-- introduzido na V31 (fix BUG-1).
--
-- IMPACTO EM PRODUÇÃO CONFIRMADO (investment 575, tenant MD Veículos,
-- 2026-04-14): surplus da parcela #19 foi aplicado na parcela #11
-- (anterior à fonte), log de reversão registra:
-- "surplus revertido na parcela #20; surplus revertido na parcela #11"
--
-- REGRA DE NEGÓCIO (BR-PAG-007): action='next' deve atingir a parcela
-- de MENOR número que seja POSTERIOR à parcela-fonte. Excedente nunca
-- deve retroagir para parcelas com número ≤ fonte.
--
-- FIX: adiciona `AND number > v_src.number` em:
--   - action 'next' (linha ~50 do V35)
--   - action 'spread' — cálculo de v_total_outstanding e loop principal
--
-- action 'last' mantido sem restrição de número: semanticamente "última
-- pendente" não tem constraint direcional; o usuário escolhe esse destino
-- conscientemente para adiantar o fim do contrato.
--
-- Preserva todos os fixes V35 (P1-P5) + recalculate_investment_status
-- (adicionado em V41 via BR-CNT-011).
-- =================================================================

CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id UUID,
  p_surplus_amount  NUMERIC,
  p_action          TEXT,
  p_paid_at         TIMESTAMPTZ DEFAULT NOW()
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

  -- ── 'next': parcelas FUTURAS em ordem crescente ─────────────────────────
  -- BR-PAG-007: somente number > v_src.number (FIX BUG-1 regressão V35)
  IF p_action = 'next' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
        AND number > v_src.number                  -- FIX BUG-1
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

  -- ── 'last': última pendente (sem restrição de número — destino intencional)
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

  -- ── 'spread': distribuição proporcional somente em parcelas FUTURAS ──────
  -- BR-PAG-007: number > v_src.number (FIX BUG-1 regressão V35)
  ELSIF p_action = 'spread' THEN
    -- Passo 1: soma outstanding apenas de parcelas posteriores à fonte
    SELECT COALESCE(SUM(
      GREATEST(0,
        amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0)
        - COALESCE(amount_paid, 0))
    ), 0)
    INTO v_total_outstanding
    FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id
      AND number > v_src.number;                   -- FIX BUG-1

    IF v_total_outstanding <= 0.01 THEN
      RETURN v_remaining;
    END IF;

    -- Passo 2: distribui cota proporcional somente em parcelas posteriores
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
        AND number > v_src.number                  -- FIX BUG-1
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

  -- BR-CNT-011: reavalia status do contrato (auto-close)
  PERFORM recalculate_investment_status(v_src.investment_id);

  RETURN GREATEST(0, v_remaining);
END;
$$;
