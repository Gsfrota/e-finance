-- =============================================================================
-- migration_v46_tenant_guard_rpcs.sql
--
-- Fecha o cross-tenant AUTENTICADO nas RPCs de dinheiro — o que sobrou depois
-- da v45 (que fechou apenas o acesso anônimo).
--
-- Problema: 14 RPCs SECURITY DEFINER recebem um UUID de parcela / id de contrato
-- e operam sobre ele SEM checar a que tenant pertence. Um admin do tenant A que
-- conheça o UUID de uma parcela do tenant B a movimenta. Provado antes da v45
-- com `anon`; depois da v45 o vetor persiste para qualquer usuário logado.
--
-- Estratégia: duas funções-guarda + uma linha `PERFORM` no topo de cada RPC.
-- A inserção é feita programaticamente a partir de pg_get_functiondef() para não
-- reescrever 14 corpos à mão (5 mil caracteres alguns) — reescrita manual de
-- função de pagamento em produção é exatamente como se introduz um bug pior que
-- o que se está corrigindo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- As guardas
-- -----------------------------------------------------------------------------
-- Âncora em auth.uid(), não no tenant. Motivo: `get_tenant_id_safe()` devolve
-- NULL tanto para backend confiável (pg_cron, service_role) quanto para um JWT
-- válido de usuário cujo profile ainda não existe. Tratar "tenant nulo" como
-- permissão liberaria o segundo caso junto com o primeiro.
--   auth.uid() IS NULL  -> não há usuário no contexto: pg_cron / service_role.
--   auth.uid() presente -> exige tenant resolvido e posse do recurso.

CREATE OR REPLACE FUNCTION public.assert_installment_in_my_tenant(p_installment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant resolvido.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loan_installments
                  WHERE id = p_installment_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Parcela não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.assert_investment_in_my_tenant(p_investment_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant resolvido.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investments
                  WHERE id = p_investment_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Contrato não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.assert_installment_in_my_tenant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_investment_in_my_tenant(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assert_installment_in_my_tenant(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.assert_investment_in_my_tenant(bigint) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Inserção da guarda nas 14 RPCs
-- -----------------------------------------------------------------------------
-- Verificado antes de aplicar: cada uma das 14 tem EXATAMENTE UM `BEGIN` isolado
-- numa linha (o do corpo, após o DECLARE), então o ponto de inserção é inequívoco.
-- Se alguma deixar de ter, a migration aborta em vez de inserir no lugar errado.
--
-- Fora desta lista, de propósito:
--   * apply_installment_payment, collect_overdue_interest, mark_installment_late,
--     pay_avulso -> já checam tenant no corpo.
--   * create_client_direct, generate_invite_code -> não recebem id de recurso;
--     criam registro no tenant do próprio chamador. Guarda diferente, análise à parte.
--   * update_overdue_installments -> global, sem parâmetro; só roda pelo cron.

DO $mig$
DECLARE r record; v_def text; v_new text; v_guard text; v_count int := 0;
BEGIN
  FOR r IN SELECT p.oid, p.proname,
                  split_part(pg_get_function_identity_arguments(p.oid),' ',1) AS p1
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef
              AND p.proname = ANY (ARRAY[
                  'pay_installment','pay_interest_only','pay_bullet_interest_only',
                  'process_bullet_payment','apply_surplus_action','apply_remainder_action',
                  'defer_remaining_to_last','refinance_installment','admin_update_installment',
                  'mark_installment_missed','revert_installment_missed','revert_installment_payment',
                  'recalculate_investment_status','generate_next_bullet_installment'])
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- idempotência: não inserir duas vezes
    CONTINUE WHEN v_def ILIKE '%assert_installment_in_my_tenant%'
               OR v_def ILIKE '%assert_investment_in_my_tenant%';

    v_guard := CASE WHEN r.p1 = 'p_installment_id'
                 THEN '  PERFORM public.assert_installment_in_my_tenant(p_installment_id);'
                 ELSE '  PERFORM public.assert_investment_in_my_tenant(p_investment_id);' END;

    v_new := regexp_replace(v_def, E'(\\n[ \\t]*BEGIN[ \\t]*\\r?\\n)', E'\\1' || v_guard || E'\n', 'i');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'Ponto de inserção não encontrado em %s — abortando', r.proname;
    END IF;

    EXECUTE v_new;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'guarda de tenant inserida em % RPCs', v_count;
END $mig$;

-- -----------------------------------------------------------------------------
-- VERIFICAÇÃO — aborta a migration inteira se algo não bater
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_sem_guarda integer;
BEGIN
  SELECT count(*) INTO v_sem_guarda
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY[
         'pay_installment','pay_interest_only','pay_bullet_interest_only',
         'process_bullet_payment','apply_surplus_action','apply_remainder_action',
         'defer_remaining_to_last','refinance_installment','admin_update_installment',
         'mark_installment_missed','revert_installment_missed','revert_installment_payment',
         'recalculate_investment_status','generate_next_bullet_installment'])
     AND p.prosrc NOT ILIKE '%assert_installment_in_my_tenant%'
     AND p.prosrc NOT ILIKE '%assert_investment_in_my_tenant%';

  IF v_sem_guarda > 0 THEN
    RAISE EXCEPTION 'FALHA: % RPC(s) ficaram sem a guarda de tenant', v_sem_guarda;
  END IF;

  RAISE NOTICE 'OK — 14 RPCs com guarda de tenant';
END $$;

COMMIT;


-- =============================================================================
-- COMPORTAMENTO VALIDADO (transação + ROLLBACK, contra dados reais de prod)
-- =============================================================================
--   cron (request.jwt.claims ausente) ............ passou
--   service_role / bot ........................... passou
--   admin QA -> parcela de OUTRO tenant .......... bloqueado 42501
--   admin QA -> parcela do PRÓPRIO tenant ........ passou (amount_paid 0 -> 1)
--   JWT válido de usuário SEM profile ............ bloqueado 42501
--
-- Também verificado ponta a ponta antes de aplicar:
--   pay_installment e admin_update_installment, chamados por um admin real
--   contra uma parcela real de outro tenant, retornam 42501 em vez de executar.
-- =============================================================================

-- =============================================================================
-- O QUE AINDA NÃO ESTÁ RESOLVIDO
-- =============================================================================
-- * Bugs de CÁLCULO (natureza diferente, não de acesso):
--     - pay_bullet_interest_only grava amount_paid += v_interest_due ignorando
--       p_amount_paid no ramo de rolagem (pagar R$ 50 de R$ 250 registra R$ 250).
--     - criação de contrato não redistribui centavos (7x: +R$ 0,05; 12x: -R$ 0,08).
--     - useDashboardData.ts:338-347 não filtra investments por status.
--   Provas em e2e/contract-db/*.dbspec.ts (8 testes vermelhos de propósito).
--
-- * 26 funções SECURITY DEFINER sem `SET search_path` (lint
--   function_search_path_mutable). Deliberadamente fora desta migration: mexer em
--   search_path e em guarda de tenant no mesmo passo, nas mesmas 14 funções de
--   dinheiro, é acumular risco sem necessidade. Merece migration própria.
-- =============================================================================

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Reverter exige restaurar os corpos anteriores (a guarda é uma linha inserida
-- dentro de cada função). O caminho seguro é neutralizar as guardas, que faz as
-- 14 RPCs voltarem ao comportamento anterior sem tocar nos corpos:
--
-- CREATE OR REPLACE FUNCTION public.assert_installment_in_my_tenant(uuid)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
-- CREATE OR REPLACE FUNCTION public.assert_investment_in_my_tenant(bigint)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
-- =============================================================================
