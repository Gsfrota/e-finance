-- Audit: Correção de dados — E-Finance Produção
-- Executar via Supabase SQL Editor ANTES da migration_v27
-- ATENÇÃO: Verificar resultados dos SELECTs antes de executar UPDATEs

-- ============================================================
-- 1.3 Investigar parcelas com paid_at preenchido mas sem amount_paid
-- (Investments 20 e 26 confirmados com este problema)
-- ============================================================

-- Diagnóstico: listar todas as parcelas com paid_at mas sem pagamento
SELECT
  li.id,
  li.investment_id,
  li.number,
  li.due_date,
  li.amount_total,
  li.amount_paid,
  li.paid_at,
  li.status,
  i.asset_name
FROM loan_installments li
JOIN investments i ON i.id = li.investment_id
WHERE li.paid_at IS NOT NULL
  AND (li.amount_paid IS NULL OR li.amount_paid < 0.01)
  AND li.status = 'pending'
ORDER BY li.investment_id, li.number;

-- DECISÃO NECESSÁRIA:
-- Opção A: Se o pagamento realmente aconteceu, preencher amount_paid = amount_total e status = 'paid'
-- UPDATE loan_installments SET amount_paid = amount_total, status = 'paid', updated_at = NOW()
-- WHERE paid_at IS NOT NULL AND (amount_paid IS NULL OR amount_paid < 0.01) AND status = 'pending';

-- Opção B: Se paid_at foi preenchido por engano, limpar o campo
-- UPDATE loan_installments SET paid_at = NULL, updated_at = NOW()
-- WHERE paid_at IS NOT NULL AND (amount_paid IS NULL OR amount_paid < 0.01) AND status = 'pending';

-- ============================================================
-- 1.4 Auditar contratos com divergência entre current_value e soma de parcelas
-- ============================================================

-- Diagnóstico: contratos onde soma das parcelas diverge do current_value
SELECT
  i.id AS investment_id,
  i.asset_name,
  i.current_value,
  COALESCE(SUM(li.amount_total), 0) AS soma_parcelas,
  i.current_value - COALESCE(SUM(li.amount_total), 0) AS diferenca,
  COUNT(li.id) AS total_parcelas,
  i.total_installments AS parcelas_esperadas
FROM investments i
LEFT JOIN loan_installments li ON li.investment_id = i.id
GROUP BY i.id, i.asset_name, i.current_value, i.total_installments
HAVING ABS(i.current_value - COALESCE(SUM(li.amount_total), 0)) > 1.00
ORDER BY ABS(i.current_value - COALESCE(SUM(li.amount_total), 0)) DESC;

-- Contratos específicos a investigar:
-- Investment 42: current_value=R$11.019,96 vs soma=R$21.101,63 (diff -R$10.081,67)
-- Investment 497: current_value=R$6.000 vs soma=R$5.700 (faltam R$300)
-- Investment 508: current_value=R$2.200 vs soma=R$1.966,62 (faltam R$233,38)
-- Investment 490: current_value=R$2.000 vs soma=R$2.110 (excede R$110)

-- Detalhe do investment 42 (maior divergência):
SELECT li.id, li.number, li.due_date, li.amount_total, li.amount_principal,
       li.amount_interest, li.status, li.amount_paid, li.created_at
FROM loan_installments li
WHERE li.investment_id = 42
ORDER BY li.number;

-- ============================================================
-- Verificação pós-correção
-- ============================================================

-- Deve retornar 0 após executar migration_v27:
SELECT COUNT(*) AS parcelas_pending_vencidas
FROM loan_installments
WHERE status = 'pending' AND due_date < CURRENT_DATE;

-- Deve retornar 0:
SELECT COUNT(*) AS parcelas_partial_incorretas
FROM loan_installments
WHERE status = 'pending' AND amount_paid > 0.01 AND amount_paid < amount_total - 0.01;

-- Verificar integridade multi-tenant (deve retornar 0):
SELECT COUNT(*) AS parcelas_tenant_mismatch
FROM loan_installments li
JOIN investments i ON i.id = li.investment_id
WHERE li.tenant_id != i.tenant_id;
