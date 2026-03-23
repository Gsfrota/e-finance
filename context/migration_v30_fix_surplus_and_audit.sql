-- =================================================================
-- V30: Fix apply_surplus_action + tabela payment_transactions
-- Corrige: amount_paid não era setado ao quitar por excedente,
--          amount_principal/interest não era ajustado proporcionalmente
-- =================================================================

-- 1. Tabela de auditoria de pagamentos
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  investment_id INTEGER NOT NULL REFERENCES investments(id),
  installment_id UUID NOT NULL REFERENCES loan_installments(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('payment', 'surplus_applied', 'surplus_received', 'deferred', 'missed')),
  amount NUMERIC NOT NULL,
  principal_portion NUMERIC DEFAULT 0,
  interest_portion NUMERIC DEFAULT 0,
  extras_portion NUMERIC DEFAULT 0,
  related_installment_id UUID REFERENCES loan_installments(id),
  related_installment_number INTEGER,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_transactions_tenant_access" ON payment_transactions
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_payment_transactions_installment ON payment_transactions(installment_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_investment ON payment_transactions(investment_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_tenant ON payment_transactions(tenant_id);

-- 2. Fix apply_surplus_action: setar amount_paid e ajustar componentes proporcionalmente
CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id UUID,
  p_surplus_amount  NUMERIC,
  p_action          TEXT   -- 'next' | 'last' | 'spread'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_src       RECORD;
  v_target    RECORD;
  v_outstanding NUMERIC;
  v_remaining   NUMERIC := p_surplus_amount;
  v_inst      RECORD;
  v_ratio     NUMERIC;
BEGIN
  SELECT * INTO v_src FROM loan_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  IF p_action = 'next' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id
    ORDER BY number ASC LIMIT 1;

    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid, 0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_target.id;
      ELSE
        v_ratio := (v_target.amount_total - p_surplus_amount) / NULLIF(v_target.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - p_surplus_amount,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_target.id;
      END IF;
    END IF;

  ELSIF p_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id = v_src.investment_id
      AND status IN ('pending', 'partial', 'late')
      AND id != p_installment_id
    ORDER BY number DESC LIMIT 1;

    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid, 0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_target.id;
      ELSE
        v_ratio := (v_target.amount_total - p_surplus_amount) / NULLIF(v_target.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - p_surplus_amount,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_target.id;
      END IF;
    END IF;

  ELSIF p_action = 'spread' THEN
    FOR v_inst IN
      SELECT * FROM loan_installments
      WHERE investment_id = v_src.investment_id
        AND status IN ('pending', 'partial', 'late')
        AND id != p_installment_id
      ORDER BY number ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_outstanding := v_inst.amount_total - COALESCE(v_inst.amount_paid, 0);
      IF v_remaining >= v_outstanding - 0.01 THEN
        UPDATE loan_installments
        SET amount_paid   = amount_total + COALESCE(fine_amount, 0) + COALESCE(interest_delay_amount, 0),
            status        = 'paid',
            paid_at       = NOW(),
            notes         = 'Quitada com excedente da parcela #' || v_src.number,
            updated_at    = NOW()
        WHERE id = v_inst.id;
        v_remaining := v_remaining - v_outstanding;
      ELSE
        v_ratio := (v_inst.amount_total - v_remaining) / NULLIF(v_inst.amount_total, 0);
        UPDATE loan_installments
        SET amount_total     = amount_total - v_remaining,
            amount_principal = amount_principal * COALESCE(v_ratio, 1),
            amount_interest  = amount_interest  * COALESCE(v_ratio, 1),
            updated_at       = NOW()
        WHERE id = v_inst.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- 3. Fix dados existentes (5 parcelas com bug de excedente)
-- Critério seguro: status=paid, amount_paid=0, principal>0, NÃO é falta (missed_at IS NULL)
UPDATE loan_installments SET
  amount_paid = amount_principal + amount_interest,
  amount_total = amount_principal + amount_interest
WHERE status = 'paid' AND amount_paid = 0 AND amount_principal > 0 AND missed_at IS NULL;

-- 4. Fix proporção quebrada em parcelas pendentes
UPDATE loan_installments SET
  amount_principal = amount_total * (amount_principal / (amount_principal + amount_interest)),
  amount_interest = amount_total * (amount_interest / (amount_principal + amount_interest))
WHERE status IN ('pending', 'partial')
  AND amount_total > 0
  AND (amount_principal + amount_interest) > 0
  AND ABS((amount_principal + amount_interest) - amount_total) > 1;
