-- Migration v39: Registrar evento late_auto no histórico ao marcar parcelas como atrasadas
-- BR: BR-PAG-021
-- Story: HIST-002
--
-- Problema: update_overdue_installments() marca pending→late silenciosamente.
-- Solução: usar CTE RETURNING para capturar os IDs atualizados e inserir em
--          payment_transactions com transaction_type = 'late_auto' atomicamente.
--
-- Nota: investment_id em loan_installments é bigint; em payment_transactions é integer.
--       Cast explícito ::integer é necessário.

CREATE OR REPLACE FUNCTION public.update_overdue_installments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Parcelas vencidas sem pagamento: pending → late
  --    + registrar evento late_auto para auditoria (BR-PAG-021)
  --    CTE RETURNING garante que só as parcelas efetivamente atualizadas recebem o evento.
  WITH newly_late AS (
    UPDATE loan_installments
    SET status = 'late', updated_at = NOW()
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
      AND (amount_paid IS NULL OR amount_paid < 0.01)
    RETURNING id, investment_id, tenant_id
  )
  INSERT INTO payment_transactions (
    tenant_id,
    investment_id,
    installment_id,
    transaction_type,
    amount,
    notes
  )
  SELECT
    nl.tenant_id,
    nl.investment_id::integer,
    nl.id,
    'late_auto',
    0,
    'Atraso detectado automaticamente'
  FROM newly_late nl
  WHERE NOT EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE pt.installment_id = nl.id
      AND pt.transaction_type = 'late_auto'
  );

  -- 2. Parcelas com pagamento parcial ainda pending: pending → partial
  UPDATE loan_installments
  SET status = 'partial', updated_at = NOW()
  WHERE status = 'pending'
    AND amount_paid > 0.01
    AND amount_paid < amount_total - 0.01;

  -- 3. Parcelas renegociadas sem pagamento (data jogada pra frente): late → pending
  UPDATE loan_installments
  SET status = 'pending', updated_at = NOW()
  WHERE status = 'late'
    AND due_date >= CURRENT_DATE
    AND (amount_paid IS NULL OR amount_paid < 0.01);

  -- 4. Parcelas renegociadas COM pagamento parcial (data jogada pra frente): late → partial
  UPDATE loan_installments
  SET status = 'partial', updated_at = NOW()
  WHERE status = 'late'
    AND due_date >= CURRENT_DATE
    AND amount_paid > 0.01
    AND amount_paid < amount_total - 0.01;
END;
$$;
