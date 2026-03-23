-- Migration v32: pay_installment aceita p_paid_at opcional (23/03/2026)
-- Applied via Supabase MCP — migration name: v32_pay_installment_custom_paid_at
--
-- Permite admin informar a data real do pagamento (ex: devedor pagou ontem, admin dá baixa hoje)
-- Default: NOW() (comportamento anterior preservado)
--
-- Mudanças frontend (não-SQL):
-- - InstallmentDetailFlow.tsx: campo "Data do Pagamento" editável (default: hoje)
-- - InstallmentDetailFlow.tsx: alerta amarelo "X dias de atraso" se paymentDate > due_date
-- - InstallmentModals.tsx: espelhadas as mesmas mudanças
-- - InstallmentHistory.tsx: "Venc: DD/MM · Pago em: DD/MM" + badge "Xd atraso"
-- - Todas as chamadas RPC passam p_paid_at com a data informada

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

  IF p_amount_paid <= 0 THEN RAISE EXCEPTION 'Valor deve ser positivo'; END IF;
  -- Permite pagamento até o saldo devedor; excedente é tratado via apply_surplus_action
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
