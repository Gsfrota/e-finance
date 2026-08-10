-- =============================================================================
-- migration_v47_bullet_payment_conservation.sql
--
-- Conserta `pay_bullet_interest_only`, a RPC de baixa dos contratos bullet
-- (calculation_mode = 'interest_only'). Dois bugs de DINHEIRO confirmados no
-- corpo real em produção (pg_get_functiondef, 05/08/2026):
--
-- (1) RAMO DE ROLAGEM — `p_amount_paid` é IGNORADO na escrita:
--         amount_paid = COALESCE(amount_paid,0) + v_interest_due
--     O parâmetro só decidia se era quitação. Operador informa R$ 50 de um juros
--     de R$ 250 -> o ledger grava R$ 250 e marca a parcela 'paid'. R$ 200 que
--     nunca entraram no caixa. Chamador afetado: InstallmentDetailFlow.tsx:729,
--     que passa um valor digitado à mão.
--
-- (2) RAMO DE QUITAÇÃO — o limiar ignora os juros:
--         v_is_settlement := v_effective_amt >= (v_remaining - 0.005)
--     `v_remaining` é só o PRINCIPAL. Pagando exatamente o principal o contrato
--     fecha e ainda grava interest_portion = v_interest_due na payment_transactions:
--     as porções somam mais que o `amount` da própria linha. Com 5000 de saldo e
--     250 de juros, fechava o contrato com R$ 250 nunca recebidos.
--
-- CORREÇÃO: um único caminho de imputação (juros primeiro, principal com o que
-- sobrar) no lugar dos dois ramos que divergiram. A quitação deixa de ser um
-- ramo separado e passa a ser o resultado natural de pagar tudo que é devido.
-- É a mesma imputação que `process_bullet_payment` (v33) já fazia certo — mas
-- aquela função não grava payment_transactions nem audit_events (que a CB-006
-- trouxe para dentro da transação), então não serve como substituta.
--
-- Invariantes que passam a valer:
--     amount = principal_portion + interest_portion         (linha do ledger fecha)
--     principal abatido + juros creditados = valor pago     (nada sem lastro)
--     juros pagos < juros do ciclo -> status 'partial'      (não quita, não rola)
--
-- Provas: e2e/contract-db/bullet-payment.dbspec.ts (`npm run test:db-contract`).
--
-- ⚠ ESCOPO: isto conserta os dois bugs acima, NÃO implementa a FR-PAG-06 inteira.
-- A BR-PAG-015 manda imputar na ordem `encargos vencidos -> juros -> principal` e
-- calcular o total exigível como `saldo + juros + encargos`. Esta versão ignora
-- `fine_amount` / `interest_delay_amount` nas duas coisas — exatamente como o corpo
-- antigo já ignorava. Medido em prod (05/08/2026): 1 parcela bullet de 123 tem
-- encargos, somando R$ 24,67. Consequência: nessa parcela a quitação fecha o
-- contrato deixando os encargos em aberto. Fica para a RPC única prevista na
-- FR-PAG-06 (itens 6 a 8), que segue "pendente de implementação".
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pay_bullet_interest_only(
  p_installment_id uuid,
  p_paid_at        timestamp with time zone DEFAULT now(),
  p_payment_method text DEFAULT 'PIX'::text,
  p_amount_paid    numeric DEFAULT NULL::numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_inst            loan_installments%ROWTYPE;
  v_inv             investments%ROWTYPE;
  v_interest_due    NUMERIC;
  v_remaining       NUMERIC;
  v_total_due       NUMERIC;
  v_effective_amt   NUMERIC;
  v_interest_paid   NUMERIC;
  v_principal_paid  NUMERIC;
  v_new_balance     NUMERIC;
  v_cycle_closed    BOOLEAN;
  v_is_settlement   BOOLEAN;
  v_new_status      TEXT;
  v_next_id         UUID;
  v_tx_id           UUID;
  v_actor_id        UUID;
  v_correlation_id  UUID := gen_random_uuid();
BEGIN
  PERFORM public.assert_installment_in_my_tenant(p_installment_id);   -- v46

  -- Os DEFAULT da assinatura não protegem contra NULL explícito, e esta RPC é
  -- chamável por qualquer usuário autenticado. paid_at nulo numa parcela quitada
  -- sumiria dos filtros por período do painel de rendimento.
  p_paid_at        := COALESCE(p_paid_at, NOW());
  p_payment_method := COALESCE(p_payment_method, 'PIX');

  SELECT * INTO v_inst FROM public.loan_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada: %', p_installment_id; END IF;

  SELECT * INTO v_inv FROM public.investments WHERE id = v_inst.investment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado: %', v_inst.investment_id; END IF;

  IF v_inv.calculation_mode <> 'interest_only' THEN
    RAISE EXCEPTION 'Esta operação é exclusiva para contratos de juros simples.';
  END IF;
  IF v_inst.status = 'paid' THEN
    RAISE EXCEPTION 'Esta parcela já está quitada.';
  END IF;

  -- Tudo que vira base de DECISÃO é normalizado em centavos antes de comparar.
  -- As colunas são `numeric` sem escala: sem isto, um juros de 250,004 faria o
  -- limiar de quitação e o de fechamento de ciclo discordarem por frações de centavo.
  v_interest_due := ROUND(GREATEST(0, v_inst.amount_interest - COALESCE(v_inst.interest_payments_total, 0)), 2);
  IF v_interest_due <= 0.005 THEN
    RAISE EXCEPTION 'Juros já quitados nesta parcela.';
  END IF;

  -- v_remaining fica SEM arredondar: é o saldo real do contrato e só aparece na
  -- subtração final, onde o ROUND absorve qualquer resíduo sub-centavo.
  v_remaining := COALESCE(v_inv.remaining_balance, v_inv.amount_invested);
  v_total_due := ROUND(v_remaining + v_interest_due, 2);   -- (2) o devido inclui os juros

  -- NULL = pagar exatamente o juros do ciclo. É o modo usado por
  -- InstallmentModals.tsx:1750 e InstallmentDetailFlow.tsx:1286 (rolagem pura).
  v_effective_amt := COALESCE(p_amount_paid, v_interest_due);
  -- Nunca registrar mais do que o devido: sobra é assunto de apply_surplus_action.
  -- ROUND em centavos: as colunas são `numeric` SEM escala, então um valor com 3+
  -- casas decimais quebraria a invariante amount = principal + interest por frações
  -- de centavo. Arredondando aqui e nos juros, a subtração abaixo é exata.
  v_effective_amt := ROUND(LEAST(v_effective_amt, v_total_due), 2);
  -- A validação vem DEPOIS do ROUND de propósito: 0,004 é positivo mas arredonda
  -- para zero, e gravaria uma transação de valor nenhum marcando a parcela.
  IF v_effective_amt <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;

  -- Imputação única: juros primeiro, principal com o que sobrar.
  -- A quitação cai daqui naturalmente (pagou tudo -> principal_paid = v_remaining).
  v_interest_paid  := ROUND(LEAST(v_effective_amt, v_interest_due), 2);
  v_principal_paid := ROUND(v_effective_amt - v_interest_paid, 2);
  v_new_balance    := ROUND(v_remaining - v_principal_paid, 2);

  v_cycle_closed  := v_interest_paid  >= v_interest_due - 0.005;  -- (1) juros do ciclo cobertos
  v_is_settlement := v_effective_amt  >= v_total_due   - 0.005;   -- (2) principal + juros
  v_new_status    := CASE WHEN v_cycle_closed THEN 'paid' ELSE 'partial' END;

  v_actor_id := auth.uid();

  UPDATE public.loan_installments SET
    amount_paid             = COALESCE(amount_paid, 0) + v_effective_amt,
    interest_payments_total = COALESCE(interest_payments_total, 0) + v_interest_paid,
    status                  = v_new_status,
    paid_at                 = CASE WHEN v_cycle_closed THEN p_paid_at ELSE paid_at END,
    payment_method          = p_payment_method,
    updated_at              = NOW()
  WHERE id = p_installment_id;

  -- Antes do generate_next_*: ele lê remaining_balance para calcular o próximo juros.
  UPDATE public.investments SET
    remaining_balance = v_new_balance,
    status            = CASE WHEN v_is_settlement THEN 'completed' ELSE status END,
    updated_at        = NOW()
  WHERE id = v_inv.id;

  INSERT INTO public.payment_transactions (
    tenant_id, investment_id, installment_id,
    transaction_type, amount,
    principal_portion, interest_portion,
    payment_method, created_at
  ) VALUES (
    v_inv.tenant_id, v_inv.id, p_installment_id,
    CASE WHEN v_is_settlement THEN 'bullet_settlement' ELSE 'bullet_interest' END,
    v_effective_amt,
    v_principal_paid, v_interest_paid,     -- somam v_effective_amt por construção
    p_payment_method, p_paid_at
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.audit_events (
    tenant_id, investment_id, installment_id, payment_id,
    event_type, source, actor_user_id,
    company_id, correlation_id,
    before, after, value_breakdown,
    created_at
  ) VALUES (
    v_inv.tenant_id, v_inv.id, p_installment_id, v_tx_id,
    CASE WHEN v_is_settlement THEN 'bullet_settled' ELSE 'bullet_rollover' END,
    'rpc', v_actor_id,
    v_inv.company_id, v_correlation_id,
    jsonb_build_object(
      'remaining_balance',   v_remaining,
      'investment_status',   v_inv.status,
      'installment_status',  v_inst.status,
      'interest_paid_total', COALESCE(v_inst.interest_payments_total, 0)
    ),
    jsonb_build_object(
      'remaining_balance',   v_new_balance,
      'investment_status',   CASE WHEN v_is_settlement THEN 'completed' ELSE v_inv.status END,
      'installment_status',  v_new_status,
      'interest_paid_total', COALESCE(v_inst.interest_payments_total, 0) + v_interest_paid
    ),
    jsonb_build_object(
      'total_paid', v_effective_amt,
      'principal',  v_principal_paid,
      'interest',   v_interest_paid
    ),
    p_paid_at
  );

  -- Rola o ciclo só quando os juros foram cobertos e ainda há saldo.
  IF v_cycle_closed AND NOT v_is_settlement THEN
    v_next_id := public.generate_next_bullet_installment(v_inv.id);
  END IF;

  RETURN json_build_object(
    'interest_paid',       v_interest_paid,
    'principal_paid',      v_principal_paid,
    'new_balance',         v_new_balance,
    'next_installment_id', v_next_id,
    'installment_status',  v_new_status,
    'contract_closed',     v_is_settlement
  );
END;
$function$;

COMMIT;


-- =============================================================================
-- MUDANÇA DE CONTRATO PARA OS CHAMADORES
-- =============================================================================
-- * p_amount_paid = NULL  -> inalterado (paga o juros do ciclo, rola, gera a próxima).
--   Cobre InstallmentModals.tsx:1750 e InstallmentDetailFlow.tsx:1286.
--
-- * QUITAÇÃO passa a exigir remaining_balance + juros pendentes. Antes bastava o
--   principal. Chamador afetado: e-finance-bot/src/actions/admin-actions.ts
--   (payBulletInterest, settle=true) mandava só `info.remainingBalance` — sem
--   ajuste, "quitar" pelo bot vira pagamento parcial e o contrato não fecha.
--   `getInstallmentBulletInfo` já devolve `interestDue`; a soma resolve.
--
-- * Pagamento parcial de juros agora deixa a parcela 'partial' em vez de 'paid'.
--   InstallmentDetailFlow.tsx:submitBulletPayment marcava `status='paid'` no
--   objeto local sem olhar o retorno; passa a ler `installment_status` do JSON.
--
-- * Retorno ganhou `installment_status` e `principal_paid` passou a vir também
--   na rolagem. Nenhuma chave foi removida ou renomeada.
-- =============================================================================

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- O corpo anterior está preservado em git (HEAD~ deste commit) e pode ser
-- reaplicado com CREATE OR REPLACE. Não há mudança de assinatura, de ACL nem de
-- schema — reverter é só reexecutar o corpo antigo.
-- Atenção: linhas de payment_transactions gravadas sob a v47 permanecem corretas
-- (amount = principal + interest); as anteriores é que não fecham.
-- =============================================================================
