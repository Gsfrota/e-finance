-- =============================================================================
-- migration_v48_centavos_distribuicao.sql
--
-- A criação de contrato não redistribui centavos. Corpo real em produção
-- (pg_get_functiondef, 06/08/2026), idêntico nas DUAS RPCs de criação:
--
--     v_amount_principal := ROUND(p_amount_invested / N, 2);
--     v_amount_interest  := ROUND((p_current_value - p_amount_invested) / N, 2);
--     FOR i IN 1..N LOOP ... INSERT (v_amount_principal, v_amount_interest, ...)
--
-- Todas as parcelas saem idênticas e o resíduo da divisão some (ou sobra).
-- Medido com o default do wizard (R$ 1.000 a 10% = R$ 1.100):
--
--     7x  -> cobra R$ 1.100,05  (R$ 0,05 a MAIS que o contrato)
--     12x -> cobra R$ 1.099,92  (R$ 0,08 a MENOS)
--     3x  -> cobra R$ 1.099,98  (R$ 0,02 a MENOS)
--     10x -> fecha (divisão exata)
--
-- E como `investments.installment_value` recebe ROUND(current_value / N, 2) —
-- uma conta DIFERENTE da soma das duas metades — o card do contrato mostra
-- R$ 157,14 e cada parcela da lista mostra R$ 157,15 na mesma tela.
--
-- `create_legacy_investment` tem os dois problemas acima MAIS um terceiro: grava
-- `amount_total = v_installment_value_rounded` enquanto amount_principal e
-- amount_interest vêm das divisões arredondadas. A linha não fecha sozinha:
-- 142,86 + 14,29 = 157,15, mas o amount_total gravado é 157,14.
--
-- CORREÇÃO: distribuir PRINCIPAL e TOTAL com o resíduo na última parcela, e
-- derivar o juros como (total - principal). É exatamente o que o frontend já faz
-- na EDIÇÃO (distributeEvenly, utils/financials.ts:10, usado em
-- AdminContracts.tsx:891-901), então criar e editar param de discordar.
--
-- Invariantes que passam a valer:
--     SUM(amount_principal) = amount_invested          (exato)
--     SUM(amount_total)     = current_value            (exato)
--     amount_total = amount_principal + amount_interest (em toda parcela)
--     installment_value (card) = amount_total da parcela regular
--
-- O card fecha de graça: com o total distribuído, a parcela regular passa a valer
-- ROUND(current_value / N, 2), que é o mesmo número que já vai para
-- installment_value. Nenhuma mudança no frontend é necessária.
--
-- MÉTODO: a transformação é feita sobre pg_get_functiondef() com âncoras exatas,
-- e ABORTA se qualquer âncora não casar exatamente uma vez. Reescrever à mão
-- duas funções de 10 mil caracteres que criam contrato é como se introduz um bug
-- pior que o que se está corrigindo (mesma disciplina da v46).
--
-- NÃO afeta bullet (interest_only): nas duas RPCs esse ramo tem INSERT próprio e
-- não passa por estas linhas.
--
-- ⚠ LIMITE CONHECIDO da convenção "resíduo na última parcela" (herdada do
-- distributeEvenly, e portanto já presente na edição): quando as duas bases
-- arredondam para CIMA, o resíduo da última pode ser negativo o suficiente para
-- o juros derivado (total - principal) ficar negativo. Medido para a forma
-- R$ 1.000 a 10%: acontece a partir de **N = 131** parcelas. As somas continuam
-- exatas nesse caso; o que fica feio é o rateio da última linha.
-- Contra os 373 contratos não-bullet reais em produção (maior N = 67), o pior
-- juros de última parcela seria **0,00** — nenhum negativo, nenhum total <= 0.
-- Corrigir de vez exige trocar a convenção por "maior resto" (distribuir os
-- centavos de 1 em 1 nas primeiras parcelas) NAS DUAS PONTAS — aqui e no
-- distributeEvenly —, senão criar e editar voltam a divergir. Decisão à parte.
--
-- Provas: e2e/contract-db/installment-generation.dbspec.ts (`npm run test:db-contract`).
-- =============================================================================

BEGIN;

DO $mig$
DECLARE
  v_def  text;
  v_new  text;
  v_oid  oid;

  -- ── âncoras: create_investment_validated ───────────────────────────────────
  -- Dollar-quoting com quebras de linha REAIS. Concatenar literais 'x\n' sem o
  -- prefixo E gravaria uma barra invertida literal e nenhuma âncora casaria.
  c_civ_decl_old CONSTANT text := $q$  v_parent_status TEXT;
BEGIN$q$;
  c_civ_decl_new CONSTANT text := $q$  v_parent_status TEXT;
  v_total_base NUMERIC; v_p NUMERIC; v_t NUMERIC;
BEGIN$q$;

  c_civ_base_old CONSTANT text := $q$v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest  := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);$q$;
  c_civ_base_new CONSTANT text := $q$v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  -- v48: distribui PRINCIPAL e TOTAL; o juros e derivado (total - principal).
  v_total_base       := ROUND(p_current_value / NULLIF(p_total_installments, 0), 2);$q$;

  c_civ_ins_old CONSTANT text := $q$    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date, v_amount_principal, v_amount_interest, ROUND(v_amount_principal + v_amount_interest, 2), 'pending');$q$;
  c_civ_ins_new CONSTANT text := $q$    -- v48: residuo da divisao vai para a ULTIMA parcela (mesma convencao do
    -- distributeEvenly que a edicao usa), para a soma fechar com o contrato.
    IF i < p_total_installments THEN
      v_p := v_amount_principal; v_t := v_total_base;
    ELSE
      v_p := ROUND(p_amount_invested - v_amount_principal * (p_total_installments - 1), 2);
      v_t := ROUND(p_current_value   - v_total_base       * (p_total_installments - 1), 2);
    END IF;
    v_amount_interest := ROUND(v_t - v_p, 2);

    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date, v_p, v_amount_interest, v_t, 'pending');$q$;

  -- ── âncoras: create_legacy_investment ──────────────────────────────────────
  c_cli_decl_old CONSTANT text := $q$  i INTEGER;
BEGIN$q$;
  c_cli_decl_new CONSTANT text := $q$  i INTEGER;
  v_total_base NUMERIC; v_p NUMERIC; v_t NUMERIC;
BEGIN$q$;

  c_cli_base_old CONSTANT text := $q$v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
    v_amount_interest := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);$q$;
  c_cli_base_new CONSTANT text := $q$v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
    -- v48: distribui PRINCIPAL e TOTAL; o juros e derivado (total - principal).
    v_total_base := ROUND(p_current_value / NULLIF(p_total_installments, 0), 2);$q$;

  c_cli_ins_old CONSTANT text := $q$    ELSE
      -- Standard mode
      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total,
        amount_paid, status, paid_at
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        v_amount_principal, v_amount_interest, v_installment_value_rounded,
        CASE WHEN i <= p_paid_count THEN v_installment_value_rounded ELSE 0 END,$q$;
  c_cli_ins_new CONSTANT text := $q$    ELSE
      -- Standard mode
      -- v48: residuo na ULTIMA parcela. Tambem corrige a linha que nao fechava:
      -- amount_total vinha de v_installment_value_rounded, nao de principal+juros.
      IF i < p_total_installments THEN
        v_p := v_amount_principal; v_t := v_total_base;
      ELSE
        v_p := ROUND(p_amount_invested - v_amount_principal * (p_total_installments - 1), 2);
        v_t := ROUND(p_current_value   - v_total_base       * (p_total_installments - 1), 2);
      END IF;
      v_amount_interest := ROUND(v_t - v_p, 2);

      INSERT INTO public.loan_installments (
        investment_id, tenant_id, company_id, number, due_date,
        amount_principal, amount_interest, amount_total,
        amount_paid, status, paid_at
      ) VALUES (
        v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date,
        v_p, v_amount_interest, v_t,
        CASE WHEN i <= p_paid_count THEN v_t ELSE 0 END,$q$;
BEGIN
  -- ═══ create_investment_validated ═══════════════════════════════════════════
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_investment_validated';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'create_investment_validated não encontrada'; END IF;

  v_def := pg_get_functiondef(v_oid);

  IF v_def LIKE '%v48%' THEN
    RAISE NOTICE 'create_investment_validated já tem a v48 — pulando';
  ELSE
    IF (length(v_def) - length(replace(v_def, c_civ_decl_old, ''))) / length(c_civ_decl_old) <> 1 THEN
      RAISE EXCEPTION 'CIV: âncora do DECLARE não casou exatamente 1x';
    END IF;
    IF (length(v_def) - length(replace(v_def, c_civ_base_old, ''))) / length(c_civ_base_old) <> 1 THEN
      RAISE EXCEPTION 'CIV: âncora do cálculo base não casou exatamente 1x';
    END IF;
    IF (length(v_def) - length(replace(v_def, c_civ_ins_old, ''))) / length(c_civ_ins_old) <> 1 THEN
      RAISE EXCEPTION 'CIV: âncora do INSERT não casou exatamente 1x';
    END IF;

    v_new := replace(v_def, c_civ_decl_old, c_civ_decl_new);
    v_new := replace(v_new, c_civ_base_old, c_civ_base_new);
    v_new := replace(v_new, c_civ_ins_old,  c_civ_ins_new);
    EXECUTE v_new;
    RAISE NOTICE 'create_investment_validated atualizada';
  END IF;

  -- ═══ create_legacy_investment ══════════════════════════════════════════════
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_legacy_investment';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'create_legacy_investment não encontrada'; END IF;

  v_def := pg_get_functiondef(v_oid);

  IF v_def LIKE '%v48%' THEN
    RAISE NOTICE 'create_legacy_investment já tem a v48 — pulando';
  ELSE
    IF (length(v_def) - length(replace(v_def, c_cli_decl_old, ''))) / length(c_cli_decl_old) <> 1 THEN
      RAISE EXCEPTION 'CLI: âncora do DECLARE não casou exatamente 1x';
    END IF;
    IF (length(v_def) - length(replace(v_def, c_cli_base_old, ''))) / length(c_cli_base_old) <> 1 THEN
      RAISE EXCEPTION 'CLI: âncora do cálculo base não casou exatamente 1x';
    END IF;
    IF (length(v_def) - length(replace(v_def, c_cli_ins_old, ''))) / length(c_cli_ins_old) <> 1 THEN
      RAISE EXCEPTION 'CLI: âncora do INSERT não casou exatamente 1x';
    END IF;

    v_new := replace(v_def, c_cli_decl_old, c_cli_decl_new);
    v_new := replace(v_new, c_cli_base_old, c_cli_base_new);
    v_new := replace(v_new, c_cli_ins_old,  c_cli_ins_new);
    EXECUTE v_new;
    RAISE NOTICE 'create_legacy_investment atualizada';
  END IF;
END $mig$;

-- -----------------------------------------------------------------------------
-- VERIFICAÇÃO — aborta a migration se algo não bater
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_faltando integer;
BEGIN
  SELECT count(*) INTO v_faltando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_investment_validated','create_legacy_investment')
     AND p.prosrc NOT LIKE '%v_total_base%';

  IF v_faltando > 0 THEN
    RAISE EXCEPTION 'FALHA: % RPC(s) de criação ficaram sem a distribuição de centavos', v_faltando;
  END IF;

  RAISE NOTICE 'OK — as 2 RPCs de criação distribuem o resíduo';
END $$;

COMMIT;


-- =============================================================================
-- O QUE NÃO MUDA
-- =============================================================================
-- * Bullet (interest_only): ramo próprio nas duas RPCs, não passa por aqui.
-- * `investments.installment_value` continua vindo do chamador. Com entrada
--   coerente ele já é ROUND(current_value / N, 2) — que agora é exatamente o
--   amount_total da parcela regular. Por isso o card deixa de divergir da lista
--   sem tocar no frontend.
-- * Contratos JÁ CRIADOS não são recalculados. A migration só muda a geração
--   daqui para frente; corrigir o passado mexeria em dívida vigente de cliente
--   real e é decisão de negócio, não de migration.
-- =============================================================================

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Os corpos anteriores estão em git (HEAD~ deste commit). Reverter é reaplicar
-- pg_get_functiondef antigo com CREATE OR REPLACE: não há mudança de assinatura,
-- de ACL nem de schema.
-- =============================================================================
