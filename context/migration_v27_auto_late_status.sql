-- Migration v27: Cron automático para atualizar status de parcelas vencidas
-- Contexto: Parcelas vencidas permanecem com status 'pending' no banco,
-- o frontend simula o status 'late' via JS, mas queries SQL e views
-- que dependem do campo status retornam resultados incorretos.

-- ============================================================
-- PARTE 1: Correção de dados existentes (executar uma vez)
-- ============================================================

-- 1.1 Parcelas vencidas sem pagamento: pending → late
UPDATE loan_installments
SET status = 'late', updated_at = NOW()
WHERE status = 'pending'
  AND due_date < CURRENT_DATE
  AND (amount_paid IS NULL OR amount_paid < 0.01);

-- 1.2 Parcelas com pagamento parcial: pending → partial
UPDATE loan_installments
SET status = 'partial', updated_at = NOW()
WHERE status = 'pending'
  AND amount_paid > 0.01
  AND amount_paid < amount_total - 0.01;

-- 1.3 Parcelas com paid_at mas sem amount_paid (investigar manualmente investments 20 e 26)
-- SELECT id, investment_id, number, due_date, amount_total, amount_paid, paid_at, status
-- FROM loan_installments
-- WHERE paid_at IS NOT NULL AND (amount_paid IS NULL OR amount_paid < 0.01) AND status = 'pending';

-- ============================================================
-- PARTE 2: Function para atualização automática de status
-- ============================================================

CREATE OR REPLACE FUNCTION update_overdue_installments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Parcelas vencidas sem pagamento: pending → late
  UPDATE loan_installments
  SET status = 'late', updated_at = NOW()
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE
    AND (amount_paid IS NULL OR amount_paid < 0.01);

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

-- ============================================================
-- PARTE 3: Cron job diário (requer extensão pg_cron)
-- ============================================================

-- Habilitar extensão pg_cron (se ainda não estiver habilitada)
-- No Supabase, habilite via Dashboard > Database > Extensions > pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Agendar execução diária às 03:05 UTC (00:05 BRT)
SELECT cron.schedule(
  'update-overdue-installments',
  '5 3 * * *',
  $$SELECT update_overdue_installments()$$
);
