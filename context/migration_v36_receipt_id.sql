-- Migration v36: Adiciona receipt_id em payment_transactions para agrupar
-- transações do mesmo evento de recebimento (BR-REL-001)
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS receipt_id UUID;
CREATE INDEX IF NOT EXISTS idx_payment_transactions_receipt
  ON payment_transactions(receipt_id)
  WHERE receipt_id IS NOT NULL;
