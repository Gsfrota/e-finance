-- Migration v33: pay_installment rejeita pagamento em parcela já quitada (24/03/2026)
-- Applied via Supabase MCP — migration name: v33_pay_installment_reject_already_paid
--
-- Problema: admin dava baixa na mesma parcela por dois caminhos diferentes
-- (DashboardWidgets → PaymentModal vs ContractDetail → InstallmentFormScreen)
-- e a RPC aceitava silenciosamente o segundo pagamento (clampava a 0, sem erro).
--
-- Fix: rejeita com EXCEPTION se outstanding <= 0.01 (parcela já quitada)
-- Frontend: ambos os fluxos agora re-fetch a parcela antes de submeter (checkStaleAndRefresh)

CREATE OR REPLACE FUNCTION public.pay_installment(
  p_installment_id uuid,
  p_amount_paid numeric,
  p_paid_at timestamptz DEFAULT NOW()
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_inst loan_installments%ROWTYPE;
  v_outstanding NUMERIC;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  v_outstanding := GREATEST(0, (v_inst.amount_total + v_inst.fine_amount + v_inst.interest_delay_amount) - v_inst.amount_paid);

  -- Rejeitar se já quitada
  IF v_outstanding <= 0.01 THEN
    RAISE EXCEPTION 'Esta parcela já está quitada.';
  END IF;

  IF p_amount_paid <= 0 THEN RAISE EXCEPTION 'Valor deve ser positivo'; END IF;

  -- Clamp ao saldo devedor
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
END;
$function$;
