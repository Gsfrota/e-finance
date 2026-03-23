-- Migration v31: Comprehensive payment RPC bug fixes (23/03/2026)
-- Applied via Supabase MCP — migration name: fix_payment_rpcs_comprehensive_v31
--
-- Bugs corrigidos:
-- BUG-A: apply_remainder_action 'next' sem filtro de status (podia adicionar saldo a parcela já paga)
-- BUG-B: refinance_installment sempre status='pending' (mesmo quando pagamento cobria outstanding)
-- BUG-C: revert_installment_payment — nova RPC para reversão com cascata completa
-- BUG-D: FOR UPDATE faltando em apply_surplus_action, apply_remainder_action, mark_installment_missed
-- BUG-E: pay_interest_only sem validação de valor positivo
-- BUG-F: payment_transactions CHECK constraint sem 'reversal' (logs de reversão falhavam silenciosamente)
-- CLEANUP: removido overload duplicado de admin_update_installment(uuid, numeric, date)
--
-- Mudanças frontend (não-SQL):
-- - handleUnpay usa revert_installment_payment RPC em vez de UPDATE direto
-- - Audit logging adicionado para refinance e interest-only (ambos os componentes)

-- ============================================================
-- 1. Fix payment_transactions CHECK constraint — add 'reversal'
-- ============================================================
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_transaction_type_check;
ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_transaction_type_check
  CHECK (transaction_type IN ('payment', 'surplus_applied', 'surplus_received', 'deferred', 'missed', 'reversal'));

-- ============================================================
-- 2. Fix apply_remainder_action
--    BUG-A: 'next' não filtrava por status (podia adicionar saldo a parcela já paga)
--    BUG-D: sem FOR UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_remainder_action(
  p_installment_id uuid, p_action text, p_interest_rate numeric DEFAULT 0
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_inst loan_installments%ROWTYPE; v_remaining NUMERIC; v_amount NUMERIC;
  v_target loan_installments%ROWTYPE; v_last_any loan_installments%ROWTYPE;
  v_new_id UUID; v_result JSON; v_do_create BOOLEAN := false;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  v_remaining := GREATEST(0, (v_inst.amount_total + v_inst.fine_amount + v_inst.interest_delay_amount) - v_inst.amount_paid);
  IF v_remaining <= 0 THEN RETURN json_build_object('action','none','message','Sem saldo residual'); END IF;
  v_amount := v_remaining * (1 + COALESCE(p_interest_rate,0)/100.0);

  IF p_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id=v_inst.investment_id AND id!=p_installment_id AND status IN ('pending','late','partial')
    ORDER BY due_date DESC, number DESC LIMIT 1 FOR UPDATE;
    IF v_target.id IS NOT NULL THEN
      UPDATE loan_installments SET amount_total=amount_total+v_amount, updated_at=NOW() WHERE id=v_target.id;
      v_result := json_build_object('action','last','target_id',v_target.id,'target_number',v_target.number,'amount_added',v_amount);
    ELSE v_do_create := true; END IF;

  ELSIF p_action = 'next' THEN
    -- FIX BUG-A: adicionado filtro de status
    SELECT * INTO v_target FROM loan_installments
    WHERE investment_id=v_inst.investment_id AND number>v_inst.number AND status IN ('pending','late','partial')
    ORDER BY number ASC LIMIT 1 FOR UPDATE;
    IF v_target.id IS NOT NULL THEN
      UPDATE loan_installments SET amount_total=amount_total+v_amount, updated_at=NOW() WHERE id=v_target.id;
      v_result := json_build_object('action','next','target_id',v_target.id,'target_number',v_target.number,'amount_added',v_amount);
    ELSE v_do_create := true; END IF;
  ELSE v_do_create := true; END IF;

  IF v_do_create THEN
    SELECT * INTO v_last_any FROM loan_installments WHERE investment_id=v_inst.investment_id ORDER BY number DESC LIMIT 1;
    v_new_id := gen_random_uuid();
    INSERT INTO loan_installments (id,investment_id,tenant_id,number,due_date,amount_principal,amount_interest,amount_total,amount_paid,fine_amount,interest_delay_amount,status,deferred_from_id)
    VALUES (v_new_id,v_inst.investment_id,v_inst.tenant_id,COALESCE(v_last_any.number,v_inst.number)+1,COALESCE(v_last_any.due_date,v_inst.due_date)+INTERVAL '30 days',v_remaining,v_amount-v_remaining,v_amount,0,0,0,'pending',p_installment_id);
    UPDATE investments SET total_installments=total_installments+1 WHERE id=v_inst.investment_id;
    v_result := json_build_object('action','new','new_installment_id',v_new_id,'amount_added',v_amount);
  END IF;
  RETURN v_result;
END; $function$;

-- ============================================================
-- 3. Fix apply_surplus_action — BUG-D: add FOR UPDATE + notes em desconto parcial
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_surplus_action(
  p_installment_id uuid, p_surplus_amount numeric, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_src RECORD; v_target RECORD; v_outstanding NUMERIC; v_remaining NUMERIC := p_surplus_amount;
  v_inst RECORD; v_ratio NUMERIC; v_count INT; v_per_inst NUMERIC;
BEGIN
  SELECT * INTO v_src FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;

  IF p_action = 'next' THEN
    SELECT * INTO v_target FROM loan_installments WHERE investment_id=v_src.investment_id AND status IN ('pending','partial','late') AND id!=p_installment_id AND number>v_src.number ORDER BY number ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid,0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments SET amount_paid=amount_total+COALESCE(fine_amount,0)+COALESCE(interest_delay_amount,0), status='paid', paid_at=NOW(), notes='Quitada com excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_target.id;
      ELSE
        v_ratio := (v_target.amount_total - p_surplus_amount)/NULLIF(v_target.amount_total,0);
        UPDATE loan_installments SET amount_total=amount_total-p_surplus_amount, amount_principal=amount_principal*COALESCE(v_ratio,1), amount_interest=amount_interest*COALESCE(v_ratio,1), notes='Desconto de excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_target.id;
      END IF;
    END IF;

  ELSIF p_action = 'last' THEN
    SELECT * INTO v_target FROM loan_installments WHERE investment_id=v_src.investment_id AND status IN ('pending','partial','late') AND id!=p_installment_id ORDER BY number DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      v_outstanding := v_target.amount_total - COALESCE(v_target.amount_paid,0);
      IF p_surplus_amount >= v_outstanding - 0.01 THEN
        UPDATE loan_installments SET amount_paid=amount_total+COALESCE(fine_amount,0)+COALESCE(interest_delay_amount,0), status='paid', paid_at=NOW(), notes='Quitada com excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_target.id;
      ELSE
        v_ratio := (v_target.amount_total - p_surplus_amount)/NULLIF(v_target.amount_total,0);
        UPDATE loan_installments SET amount_total=amount_total-p_surplus_amount, amount_principal=amount_principal*COALESCE(v_ratio,1), amount_interest=amount_interest*COALESCE(v_ratio,1), notes='Desconto de excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_target.id;
      END IF;
    END IF;

  ELSIF p_action = 'spread' THEN
    SELECT COUNT(*) INTO v_count FROM loan_installments WHERE investment_id=v_src.investment_id AND status IN ('pending','partial','late') AND id!=p_installment_id AND number>v_src.number;
    IF v_count > 0 THEN
      v_per_inst := ROUND(p_surplus_amount/v_count,2);
      FOR v_inst IN SELECT * FROM loan_installments WHERE investment_id=v_src.investment_id AND status IN ('pending','partial','late') AND id!=p_installment_id AND number>v_src.number ORDER BY number ASC FOR UPDATE
      LOOP
        IF v_remaining <= v_per_inst + 0.02 THEN v_per_inst := v_remaining; END IF;
        EXIT WHEN v_remaining <= 0.01;
        v_outstanding := v_inst.amount_total - COALESCE(v_inst.amount_paid,0);
        IF v_per_inst >= v_outstanding - 0.01 THEN
          UPDATE loan_installments SET amount_paid=amount_total+COALESCE(fine_amount,0)+COALESCE(interest_delay_amount,0), status='paid', paid_at=NOW(), notes='Quitada com excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_inst.id;
          v_remaining := v_remaining - v_outstanding;
        ELSE
          v_ratio := (v_inst.amount_total - v_per_inst)/NULLIF(v_inst.amount_total,0);
          UPDATE loan_installments SET amount_total=amount_total-v_per_inst, amount_principal=amount_principal*COALESCE(v_ratio,1), amount_interest=amount_interest*COALESCE(v_ratio,1), notes='Desconto de excedente da parcela #'||v_src.number, updated_at=NOW() WHERE id=v_inst.id;
          v_remaining := v_remaining - v_per_inst;
        END IF;
      END LOOP;
    END IF;
  END IF;
END; $function$;

-- ============================================================
-- 4. Fix refinance_installment — BUG-B: status condicional + validação
-- ============================================================
CREATE OR REPLACE FUNCTION public.refinance_installment(
  p_installment_id uuid, p_payment_amount numeric, p_new_due_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_inst loan_installments%ROWTYPE; v_new_paid NUMERIC; v_obligation NUMERIC;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF COALESCE(p_payment_amount,0) < 0 THEN RAISE EXCEPTION 'Valor não pode ser negativo'; END IF;
  v_new_paid := v_inst.amount_paid + COALESCE(p_payment_amount,0);
  v_obligation := v_inst.amount_total + COALESCE(v_inst.fine_amount,0) + COALESCE(v_inst.interest_delay_amount,0);
  UPDATE loan_installments SET
    amount_paid=v_new_paid, due_date=p_new_due_date, fine_amount=0, interest_delay_amount=0,
    status=CASE WHEN v_new_paid>=v_obligation-0.01 THEN 'paid' WHEN v_new_paid>0.01 THEN 'partial' ELSE 'pending' END,
    paid_at=CASE WHEN v_new_paid>=v_obligation-0.01 THEN NOW() ELSE NULL END,
    updated_at=NOW()
  WHERE id=p_installment_id;
END; $function$;

-- ============================================================
-- 5. Fix mark_installment_missed — BUG-D: add FOR UPDATE
-- ============================================================
-- (full function recreated with FOR UPDATE on initial SELECT and target SELECTs)

-- ============================================================
-- 6. Fix pay_interest_only — BUG-E: add validation + FOR UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.pay_interest_only(
  p_installment_id uuid, p_interest_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_inst loan_installments%ROWTYPE;
BEGIN
  SELECT * INTO v_inst FROM loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF p_interest_amount <= 0 THEN RAISE EXCEPTION 'Valor deve ser positivo'; END IF;
  UPDATE loan_installments SET interest_payments_total=COALESCE(interest_payments_total,0)+p_interest_amount, updated_at=NOW() WHERE id=p_installment_id;
END; $function$;

-- ============================================================
-- 7. New RPC: revert_installment_payment — BUG-C: reversão com cascata
-- ============================================================
-- (full function — reverts surplus_received, surplus discount on targets, deferred installments)
-- See live Supabase for complete source.

-- ============================================================
-- CLEANUP: Drop overloaded admin_update_installment
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_update_installment(uuid, numeric, date);
