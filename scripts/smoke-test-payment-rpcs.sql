-- ============================================================================
-- Smoke Test: RPCs de Pagamento (Baixas)
-- ============================================================================
-- Fluxo classificado como EXTREMAMENTE CRITICO (BR-PAG-019).
-- Executar antes de qualquer deploy que toque em pagamentos.
--
-- USO:
--   1. Conecte ao banco via psql, DBeaver, ou Supabase SQL Editor
--   2. Execute este script inteiro
--   3. Verifique que NENHUM resultado retorna "ERRO" na coluna status
--
-- IMPORTANTE: Este script usa DO/ROLLBACK para nao persistir dados.
--   Os testes rodam dentro de um bloco que faz ROLLBACK ao final.
--   Nenhuma parcela real sera alterada.
-- ============================================================================

-- ============================================================================
-- PARTE 1: Verificar integridade das assinaturas (sem dados necessarios)
-- ============================================================================

SELECT
  'VERIFICACAO DE OVERLOADS' as secao,
  proname,
  count(*) as overload_count,
  CASE WHEN count(*) = 1 THEN 'OK' ELSE 'ERRO — overload duplicado!' END as status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname IN (
  'pay_installment','apply_surplus_action','apply_remainder_action',
  'mark_installment_missed','revert_installment_payment','refinance_installment',
  'admin_update_installment','pay_avulso','pay_bullet_interest_only',
  'generate_next_bullet_installment'
)
GROUP BY proname

UNION ALL

-- BR-PAG-021: update_overdue_installments deve ter CTE late_auto (migration v39)
SELECT
  'VERIFICACAO BR-PAG-021' as secao,
  'update_overdue_installments' as proname,
  1 as overload_count,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'update_overdue_installments'
        AND p.prosrc LIKE '%late_auto%'
        AND p.prosrc LIKE '%newly_late%'
    ) THEN 'OK — late_auto CTE presente'
    ELSE 'ERRO — migration v39 nao aplicada (falta late_auto)'
  END as status
ORDER BY proname;

-- ============================================================================
-- PARTE 2: Verificar assinatura correta de pay_installment
-- ============================================================================

SELECT
  'ASSINATURA pay_installment' as secao,
  pg_get_function_arguments(p.oid) as args,
  CASE
    WHEN pg_get_function_arguments(p.oid) LIKE '%p_paid_at%' THEN 'OK — versao com p_paid_at'
    ELSE 'ERRO — versao antiga sem p_paid_at ainda existe!'
  END as status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'pay_installment';

-- ============================================================================
-- PARTE 3: Verificar existencia de parcelas para teste
-- ============================================================================

SELECT
  'DADOS DISPONIVEIS' as secao,
  status,
  count(*) as total,
  CASE WHEN count(*) > 0 THEN 'OK' ELSE 'AVISO — sem parcelas neste status' END as status_check
FROM loan_installments
WHERE status IN ('pending', 'late', 'partial', 'paid')
GROUP BY status
ORDER BY status;

-- ============================================================================
-- PARTE 4: Teste funcional (em transacao revertida)
-- ============================================================================
-- Cada bloco testa 1 tipo de baixa e exibe OK ou ERRO.
-- Todos os dados sao revertidos ao final (ROLLBACK).

DO $$
DECLARE
  v_pending_id   uuid;
  v_late_id      uuid;
  v_paid_id      uuid;
  v_investment_id bigint;
  v_outstanding  numeric;
  v_result       text;
BEGIN

  -- Buscar parcela pending para testes
  SELECT id, (amount_total + fine_amount + interest_delay_amount - amount_paid),
         investment_id
  INTO v_pending_id, v_outstanding, v_investment_id
  FROM loan_installments
  WHERE status = 'pending' AND amount_total > 0
  ORDER BY due_date
  LIMIT 1;

  -- Buscar parcela atrasada para testes
  SELECT id INTO v_late_id
  FROM loan_installments
  WHERE status = 'late'
  ORDER BY due_date
  LIMIT 1;

  -- Buscar parcela ja paga para testar rejeicao de duplicata
  SELECT id INTO v_paid_id
  FROM loan_installments
  WHERE status = 'paid'
  ORDER BY paid_at DESC
  LIMIT 1;

  RAISE NOTICE '=== SMOKE TEST: RPCs DE PAGAMENTO ===';
  RAISE NOTICE 'parcela pending: %', v_pending_id;
  RAISE NOTICE 'parcela late:    %', v_late_id;
  RAISE NOTICE 'parcela paid:    %', v_paid_id;
  RAISE NOTICE 'outstanding:     %', v_outstanding;

  -- ── Teste 1: pay_installment (pagamento exato) ──────────────────────────
  IF v_pending_id IS NOT NULL THEN
    BEGIN
      PERFORM public.pay_installment(v_pending_id, v_outstanding, now());
      RAISE NOTICE '[OK] pay_installment — pagamento exato funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] pay_installment: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] pay_installment — sem parcela pending';
  END IF;

  -- ── Teste 2: pay_installment em parcela ja paga (deve rejeitar) ─────────
  IF v_paid_id IS NOT NULL THEN
    BEGIN
      PERFORM public.pay_installment(v_paid_id, 1.00, now());
      RAISE NOTICE '[ERRO] pay_installment parcela paga — deveria ter rejeitado!';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%quitada%' OR SQLERRM LIKE '%already%' THEN
        RAISE NOTICE '[OK] pay_installment — rejeita duplicata corretamente';
      ELSE
        RAISE NOTICE '[ERRO] pay_installment duplicata: erro inesperado: %', SQLERRM;
      END IF;
    END;
  ELSE
    RAISE NOTICE '[SKIP] pay_installment duplicata — sem parcela paid';
  END IF;

  -- ── Teste 3: apply_surplus_action ───────────────────────────────────────
  IF v_pending_id IS NOT NULL THEN
    BEGIN
      PERFORM public.apply_surplus_action(v_pending_id, 10.00, 'next', now());
      RAISE NOTICE '[OK] apply_surplus_action (next) funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] apply_surplus_action: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] apply_surplus_action — sem parcela pending';
  END IF;

  -- ── Teste 4: apply_remainder_action ─────────────────────────────────────
  IF v_pending_id IS NOT NULL THEN
    BEGIN
      PERFORM public.apply_remainder_action(v_pending_id, 'next', 0);
      RAISE NOTICE '[OK] apply_remainder_action (next) funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] apply_remainder_action: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] apply_remainder_action — sem parcela pending';
  END IF;

  -- ── Teste 5: admin_update_installment ───────────────────────────────────
  IF v_pending_id IS NOT NULL THEN
    BEGIN
      PERFORM public.admin_update_installment(v_pending_id, NULL, NULL);
      RAISE NOTICE '[OK] admin_update_installment funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] admin_update_installment: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] admin_update_installment — sem parcela pending';
  END IF;

  -- ── Teste 6: mark_installment_missed ────────────────────────────────────
  IF v_late_id IS NOT NULL THEN
    BEGIN
      PERFORM public.mark_installment_missed(v_late_id, 'last');
      RAISE NOTICE '[OK] mark_installment_missed funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] mark_installment_missed: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] mark_installment_missed — sem parcela late';
  END IF;

  -- ── Teste 7: revert_installment_payment ─────────────────────────────────
  IF v_paid_id IS NOT NULL THEN
    BEGIN
      PERFORM public.revert_installment_payment(v_paid_id);
      RAISE NOTICE '[OK] revert_installment_payment funcionou';
    EXCEPTION WHEN OTHERS THEN
      -- Pode rejeitar por janela de 72h ou permissao — isso e esperado
      IF SQLERRM LIKE '%72%' OR SQLERRM LIKE '%admin%' OR SQLERRM LIKE '%nao encontrada%' THEN
        RAISE NOTICE '[OK] revert_installment_payment — rejeicao esperada: %', SQLERRM;
      ELSE
        RAISE NOTICE '[ERRO] revert_installment_payment: %', SQLERRM;
      END IF;
    END;
  ELSE
    RAISE NOTICE '[SKIP] revert_installment_payment — sem parcela paid';
  END IF;

  -- ── Teste 8: refinance_installment ──────────────────────────────────────
  IF v_pending_id IS NOT NULL AND v_outstanding > 1 THEN
    BEGIN
      PERFORM public.refinance_installment(v_pending_id, 1.00, CURRENT_DATE + 30);
      RAISE NOTICE '[OK] refinance_installment funcionou';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[ERRO] refinance_installment: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[SKIP] refinance_installment — sem dados suficientes';
  END IF;

  RAISE NOTICE '=== FIM DO SMOKE TEST (ROLLBACK — nenhum dado alterado) ===';

  -- Reverter TUDO — nenhuma alteracao persiste
  RAISE EXCEPTION 'ROLLBACK_INTENCIONAL';

EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_INTENCIONAL' THEN
      RAISE NOTICE 'Transacao revertida conforme esperado. Banco inalterado.';
    ELSE
      RAISE NOTICE 'Erro inesperado no bloco de teste: %', SQLERRM;
    END IF;
END;
$$;

-- ============================================================================
-- RESULTADO ESPERADO:
--   Todas as linhas da PARTE 1 com status = 'OK'
--   PARTE 2 com 'OK — versao com p_paid_at'
--   PARTE 4 com todas as linhas [OK] ou [SKIP] (nunca [ERRO])
-- ============================================================================
