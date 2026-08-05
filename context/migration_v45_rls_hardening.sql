-- =============================================================================
-- migration_v45_rls_hardening.sql
--
-- Fecha dois vetores confirmados em produção em 04-05/08/2026:
--   (1) view_investor_balances vazando saldos de todos os tenants
--   (2) RPCs que movimentam dinheiro executáveis por `anon` (sem login)
--
-- NÃO aplicada. Revisar antes de rodar.
-- Provas e medições: e2e/contract-db/*.dbspec.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PARTE 1 — view_investor_balances respeita a RLS do chamador
-- -----------------------------------------------------------------------------
-- Diagnóstico: a view não tinha `security_invoker` (reloptions NULL), então
-- rodava com os privilégios do owner (postgres, superuser) e ignorava a RLS de
-- profiles/investments/loan_installments. Ela também não filtra tenant no corpo.
--
-- Medido em prod, como role `authenticated` com um JWT cujo `sub` NEM EXISTE:
--     SELECT count(*), count(DISTINCT tenant_id) FROM view_investor_balances
--       -> 109 linhas, 21 tenants
--     SELECT count(*) FROM profiles      (mesma sessão)
--       -> 0 linhas   [a RLS da tabela está correta; a view é que passava por cima]
--
-- Expunha: full_name, total_own_capital, total_profit_reinvested,
--          total_profit_received, available_profit_balance  — de todos os tenants.
--
-- O app se salvava por acidente: sempre consulta filtrando por profile_id
-- (AdminContracts.tsx:361, AdminUserDetails.tsx:244). A API REST, não.
--
-- VALIDAÇÃO desta correção (executada em transação com ROLLBACK, como o admin
-- do tenant QA 717d4065-8b30-4056-bde4-3cc50808d48b):
--     antes  : 109 linhas / 21 tenants
--     depois :   7 linhas /  1 tenant
--     linhas do próprio tenant perdidas ....... 0
--     linhas alteradas ou novas ............... 0
-- Ou seja: corta as 102 linhas alheias e preserva byte a byte as 7 legítimas.
-- Zero mudança de comportamento para o app.
--
-- Por que security_invoker basta (em vez de reescrever a view com filtro de
-- tenant): as policies relevantes já são exatamente o filtro desejado —
--   profiles_select_multi_company      : tenant_id = get_tenant_id_safe() AND (role='admin' OR id = get_profile_id_safe())
--   investments_select_multi_company   : tenant_id = get_tenant_id_safe() AND ...
--   installments_select_multi_company  : tenant_id = get_tenant_id_safe() AND ...
-- Com security_invoker a view herda as três, sem duplicar regra de tenant no corpo.

ALTER VIEW public.view_investor_balances SET (security_invoker = on);


-- -----------------------------------------------------------------------------
-- PARTE 2 — tirar de `anon` as RPCs que movimentam dinheiro
-- -----------------------------------------------------------------------------
-- Diagnóstico: 57 funções SECURITY DEFINER tinham EXECUTE para `anon`. As de
-- pagamento não checam tenant nem role no corpo. Resultado: uma requisição SEM
-- header Authorization, portando apenas a apikey pública (que está no bundle JS
-- servido a qualquer visitante), movimenta dinheiro.
--
-- Provado em prod contra fixture própria:
--     POST /rest/v1/rpc/pay_installment        (anon, sem Authorization) -> HTTP 204, amount_paid 0 -> 1
--     POST /rest/v1/rpc/admin_update_installment (idem)                  -> HTTP 204, amount_total 366,66 -> 1
--
-- A única barreira restante é o UUID da parcela não ser adivinhável — segurança
-- por obscuridade, e UUIDs vazam em logs, URLs e exports.
--
-- ESCOPO desta parte: apenas funções de negócio/dinheiro. Deliberadamente FORA:
--
--   * helpers de RLS (get_tenant_id_safe, get_profile_role_safe, is_admin,
--     check_is_admin, company_belongs_to_my_tenant, resolve_company_id_for_tenant, ...)
--     -> são chamados DENTRO das policies. Sem EXECUTE, a policy ERRA em vez de
--        retornar vazio, e o login/signup quebra. NÃO REVOGAR.
--
--   * trigger functions (handle_new_user, sync_tenant_to_jwt, protect_*,
--     set_investment_created_by) -> executadas pelo trigger, não pelo chamador.
--
--   * platform_* -> já se defendem por dentro: todas checam is_platform_owner()
--     e dão RAISE EXCEPTION. Verificado.
--
--   * complete_oauth_onboarding, recover_account_setup, ensure_primary_company
--     -> podem ser parte legítima do fluxo pré-autenticação. Exigem análise do
--        caminho de signup antes de mexer. Deixadas como estão de propósito.
--
-- service_role mantém EXECUTE em todas (verificado: 15/15) — bot, cron e edge
-- functions não são afetados. O app web chama como `authenticated`, também intacto.
--
-- ⚠ ATENÇÃO ao mecanismo: `REVOKE ... FROM anon` sozinho NÃO funciona aqui.
-- O ACL destas funções é:
--     {=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- O primeiro item (`=X`) é o grant para PUBLIC, que o Postgres dá por padrão a
-- toda função criada. Revogando só de `anon`, ele continua herdando via PUBLIC —
-- verificado empiricamente: has_function_privilege('anon', ...) seguia true.
-- Por isso revogamos de PUBLIC *e* de anon, e re-concedemos explicitamente aos
-- dois roles que precisam.

DO $$
DECLARE
  r        record;
  v_count  integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname = ANY (ARRAY[
             -- baixa e movimentação de parcela
             'pay_installment',
             'pay_avulso',
             'pay_interest_only',
             'pay_bullet_interest_only',
             'process_bullet_payment',
             'apply_installment_payment',
             'apply_surplus_action',
             'apply_remainder_action',
             'defer_remaining_to_last',
             'collect_overdue_interest',
             'refinance_installment',
             -- estado de parcela
             'admin_update_installment',
             'mark_installment_late',
             'mark_installment_missed',
             'revert_installment_missed',
             'revert_installment_payment',
             'update_overdue_installments',
             -- contrato
             'create_investment_validated',
             'create_legacy_investment',
             'generate_installments_automatically',
             'generate_next_bullet_installment',
             'recalculate_investment_status',
             -- cadastro e convite
             'create_client_direct',
             'generate_invite_code',
             -- leitura agregada de negócio
             'get_admin_dashboard_stats',
             'get_admin_metrics',
             'get_available_profit_balance',
             -- auditoria e outros
             'log_audit_event',
             'import_products_batch',
             'recalculate_order_total'
           ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'REVOKE aplicado em % assinaturas (overloads incluídos)', v_count;
END $$;


-- -----------------------------------------------------------------------------
-- VERIFICAÇÃO — deve retornar 0 linhas antes do COMMIT
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_resto integer;
BEGIN
  SELECT count(*) INTO v_resto
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname = ANY (ARRAY[
           'pay_installment','pay_avulso','pay_interest_only','pay_bullet_interest_only',
           'process_bullet_payment','apply_installment_payment','apply_surplus_action',
           'apply_remainder_action','defer_remaining_to_last','collect_overdue_interest',
           'refinance_installment','admin_update_installment','mark_installment_late',
           'mark_installment_missed','revert_installment_missed','revert_installment_payment',
           'update_overdue_installments','create_investment_validated','create_legacy_investment',
           'generate_installments_automatically','generate_next_bullet_installment',
           'recalculate_investment_status','create_client_direct','generate_invite_code',
           'get_admin_dashboard_stats','get_admin_metrics','get_available_profit_balance',
           'log_audit_event','import_products_batch','recalculate_order_total']);

  IF v_resto > 0 THEN
    RAISE EXCEPTION 'FALHA: % função(ões) de dinheiro ainda executáveis por anon', v_resto;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname='view_investor_balances'
       AND c.reloptions @> ARRAY['security_invoker=on']
  ) THEN
    RAISE EXCEPTION 'FALHA: view_investor_balances sem security_invoker';
  END IF;

  RAISE NOTICE 'OK — view isolada por tenant e RPCs de dinheiro fechadas para anon';
END $$;

COMMIT;


-- =============================================================================
-- O QUE ESTA MIGRATION *NÃO* RESOLVE
-- =============================================================================
-- Fecha o vetor "sem autenticação nenhuma". NÃO fecha o cross-tenant autenticado:
-- um admin do tenant A que conheça o UUID de uma parcela do tenant B ainda
-- consegue chamar pay_installment / admin_update_installment / etc. e movimentá-la,
-- porque essas RPCs continuam sem checagem de tenant no corpo.
--
-- A correção completa é adicionar, em cada uma, a guarda que create_investment_validated,
-- create_legacy_investment e pay_avulso já têm:
--     IF v_inv.tenant_id <> get_tenant_id_safe() THEN
--       RAISE EXCEPTION 'Operação fora do seu tenant.';
--     END IF;
-- São ~11 corpos de função. Fica para uma migration própria — mexer neles é bem
-- mais arriscado que um REVOKE e merece testar um por um.
--
-- Também fora de escopo (bugs de cálculo, não de acesso):
--   * pay_bullet_interest_only grava amount_paid += v_interest_due ignorando
--     p_amount_paid no ramo de rolagem: pagar R$ 50 de um juros de R$ 250 registra
--     R$ 250 e marca a parcela como paid. A implementação correta
--     (process_bullet_payment) já existe e tem zero callers.
--   * criação de contrato não redistribui centavos: 1000/10%/7x cobra R$ 0,05 a
--     mais; 12x, R$ 0,08 a menos.
-- =============================================================================


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- ALTER VIEW public.view_investor_balances SET (security_invoker = off);
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT p.oid::regprocedure AS sig
--              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--             WHERE n.nspname='public'
--               AND p.proname = ANY (ARRAY[ ...mesma lista... ])
--   LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
--   END LOOP;
-- END $$;
-- COMMIT;
-- =============================================================================
