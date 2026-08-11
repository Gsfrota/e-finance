-- ============================================================================
-- Migration v52 — idempotência forte + ledger atômico da baixa offline
-- ============================================================================
-- Provas executáveis da Task 2 encontraram dois riscos que a v51 não fechava:
--
-- 1. A baixa offline atualizava loan_installments, mas deixava ZERO linhas em
--    payment_transactions. No fluxo online esse INSERT é feito pelo React, após
--    a RPC, em modo non-blocking; o sincronizador offline não passa por esse
--    trecho. Isso viola BR-PAG-009 e apaga a baixa do histórico centralizado.
--
-- 2. A v51 capturava unique_violation, mas depois seguia direto para
--    pay_installment. Em uma corrida real, o perdedor poderia aplicar o mesmo
--    UUID outra vez. INSERT ... ON CONFLICT + SELECT FOR UPDATE transforma a
--    linha da intenção no mutex: o segundo request espera, relê 'applied' e sai.
--
-- A retomada também passa a usar installment_id/amount/paid_at PERSISTIDOS. O
-- UUID identifica aquele payload; parâmetros diferentes num retry não podem
-- redirecionar dinheiro nem reescrever a data capturada em campo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_offline_payment(
  p_intent_id      uuid,
  p_installment_id uuid,
  p_amount         numeric,
  p_paid_at        timestamptz
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_tenant             uuid;
  v_intent             public.offline_payment_intents%ROWTYPE;
  v_inst               public.loan_installments%ROWTYPE;
  v_amount_after       numeric;
  v_amount_applied     numeric;
  v_obligation         numeric;
  v_principal_portion  numeric;
  v_interest_portion   numeric;
  v_extras_portion     numeric;
BEGIN
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant resolvido.' USING ERRCODE = '42501';
  END IF;

  IF public.get_profile_role_safe() <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem sincronizar baixas offline.' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor da baixa deve ser maior que zero (recebido: %).', p_amount;
  END IF;

  IF p_paid_at IS NULL OR p_paid_at > NOW() + INTERVAL '1 day' THEN
    RAISE EXCEPTION 'Data do pagamento não pode estar no futuro (recebida: %).', p_paid_at;
  END IF;

  -- Valida o recurso recebido antes do INSERT. A FK sozinha permitiria gravar
  -- tenant_id do chamador apontando para uma parcela de outro tenant.
  IF NOT EXISTS (
    SELECT 1
      FROM public.loan_installments li
      JOIN public.investments i ON i.id = li.investment_id
     WHERE li.id = p_installment_id
       AND i.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Parcela não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  -- O conflito não é erro: pode ser retry ou request concorrente. Se outra
  -- transação ainda estiver inserindo este id, o PostgreSQL espera a decisão
  -- dela antes de seguir. A leitura com lock abaixo vê o estado já confirmado.
  INSERT INTO public.offline_payment_intents
    (id, tenant_id, installment_id, amount, paid_at, created_by)
  VALUES
    (p_intent_id, v_tenant, p_installment_id, p_amount, p_paid_at, auth.uid())
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_intent
    FROM public.offline_payment_intents
   WHERE id = p_intent_id
     AND tenant_id = v_tenant
     FOR UPDATE;

  -- Um id existente em outro tenant não pode ser lido, atualizado nem usado
  -- como ponte para pagar uma parcela deste tenant.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intenção não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  IF v_intent.status IN ('applied', 'resolved') THEN
    RETURN jsonb_build_object('status', v_intent.status, 'duplicada', true);
  END IF;

  -- A linha persistida é a autoridade na retomada. O lock também serializa
  -- intenções diferentes que tentem movimentar a mesma parcela ao mesmo tempo.
  SELECT li.* INTO v_inst
    FROM public.loan_installments li
    JOIN public.investments i ON i.id = li.investment_id
   WHERE li.id = v_intent.installment_id
     AND i.tenant_id = v_tenant
   FOR UPDATE OF li;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcela da intenção não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  IF v_intent.amount IS NULL OR v_intent.amount <= 0 THEN
    RAISE EXCEPTION 'Valor persistido da baixa deve ser maior que zero.';
  END IF;

  IF v_intent.paid_at IS NULL OR v_intent.paid_at > NOW() + INTERVAL '1 day' THEN
    UPDATE public.offline_payment_intents
       SET status = 'rejected',
           error_message = 'Data persistida do pagamento não pode estar no futuro.',
           resolved_at = NOW()
     WHERE id = v_intent.id
       AND tenant_id = v_tenant;
    RETURN jsonb_build_object(
      'status', 'rejected',
      'erro', 'Data persistida do pagamento não pode estar no futuro.',
      'duplicada', false
    );
  END IF;

  -- O savepoint preserva a intenção em rejeições de negócio. Pagamento, ledger
  -- e status applied ficam na mesma subtransação: ou os três persistem, ou
  -- nenhum deles persiste.
  BEGIN
    PERFORM public.pay_installment(
      v_intent.installment_id,
      v_intent.amount,
      v_intent.paid_at
    );

    SELECT COALESCE(amount_paid, 0) INTO v_amount_after
      FROM public.loan_installments
     WHERE id = v_intent.installment_id;

    v_amount_applied := v_amount_after - COALESCE(v_inst.amount_paid, 0);
    IF v_amount_applied <= 0 THEN
      RAISE EXCEPTION 'A baixa não aplicou valor à parcela.';
    END IF;

    -- Mesmo rateio proporcional usado por services/paymentAudit.ts. Juros e
    -- extras são arredondados; principal recebe o resíduo para a soma fechar
    -- exatamente no valor que pay_installment de fato aplicou.
    v_obligation := COALESCE(v_inst.amount_principal, 0)
                  + COALESCE(v_inst.amount_interest, 0)
                  + COALESCE(v_inst.fine_amount, 0)
                  + COALESCE(v_inst.interest_delay_amount, 0);

    IF v_obligation > 0 THEN
      v_interest_portion := ROUND(
        v_amount_applied * COALESCE(v_inst.amount_interest, 0) / v_obligation,
        2
      );
      v_extras_portion := ROUND(
        v_amount_applied
          * (COALESCE(v_inst.fine_amount, 0) + COALESCE(v_inst.interest_delay_amount, 0))
          / v_obligation,
        2
      );
      v_principal_portion := v_amount_applied - v_interest_portion - v_extras_portion;
    ELSE
      v_principal_portion := v_amount_applied;
      v_interest_portion := 0;
      v_extras_portion := 0;
    END IF;

    INSERT INTO public.payment_transactions (
      tenant_id,
      investment_id,
      installment_id,
      transaction_type,
      amount,
      principal_portion,
      interest_portion,
      extras_portion,
      notes,
      receipt_id,
      created_at
    ) VALUES (
      v_tenant,
      v_inst.investment_id,
      v_intent.installment_id,
      'payment',
      v_amount_applied,
      v_principal_portion,
      v_interest_portion,
      v_extras_portion,
      'Baixa offline sincronizada — intenção ' || v_intent.id::text,
      v_intent.id,
      v_intent.paid_at
    );

    UPDATE public.offline_payment_intents
       SET status = 'applied',
           error_message = NULL,
           resolved_at = NOW()
     WHERE id = v_intent.id
       AND tenant_id = v_tenant;

    RETURN jsonb_build_object('status', 'applied', 'duplicada', false);
  EXCEPTION
    -- Transitórios continuam sendo retry técnico: desfaz tudo e devolve erro ao
    -- cliente, que conserva a intenção local para novo envio.
    WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled THEN
      RAISE;
    WHEN OTHERS THEN
      UPDATE public.offline_payment_intents
         SET status = 'rejected',
             error_message = SQLERRM,
             resolved_at = NOW()
       WHERE id = v_intent.id
         AND tenant_id = v_tenant;
      RETURN jsonb_build_object(
        'status', 'rejected',
        'erro', SQLERRM,
        'duplicada', false
      );
  END;
END;
$function$;

-- CREATE OR REPLACE exige repetir o fechamento explícito: PUBLIC é herdado por
-- anon. Só usuários autenticados podem sincronizar dinheiro.
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) TO authenticated;


-- ----------------------------------------------------------------------------
-- Resolver uma rejeição como pagamento avulso
-- ----------------------------------------------------------------------------
-- Não pode ser uma sequência client-side `pay_avulso -> UPDATE intent`: se a
-- resposta do primeiro request sumir, um retry cria outro avulso. Esta RPC usa a
-- própria intenção como chave idempotente e confirma os dois efeitos juntos.
CREATE OR REPLACE FUNCTION public.resolve_offline_intent_as_avulso(
  p_intent_id   uuid,
  p_destination text DEFAULT 'general_credit',
  p_notes       text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_tenant        uuid;
  v_intent        public.offline_payment_intents%ROWTYPE;
  v_investment_id bigint;
  v_avulso        jsonb;
BEGIN
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL OR public.get_profile_role_safe() <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores do tenant podem resolver baixas offline.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_intent
    FROM public.offline_payment_intents
   WHERE id = p_intent_id
     AND tenant_id = v_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intenção offline não encontrada.';
  END IF;

  IF v_intent.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'resolved', 'duplicada', true);
  END IF;

  IF v_intent.status = 'applied' THEN
    RAISE EXCEPTION 'A intenção já foi aplicada como baixa de parcela.';
  END IF;

  IF v_intent.status <> 'rejected' THEN
    RAISE EXCEPTION 'Somente uma intenção rejeitada pode virar pagamento avulso.';
  END IF;

  SELECT li.investment_id INTO v_investment_id
    FROM public.loan_installments li
    JOIN public.investments i ON i.id = li.investment_id
   WHERE li.id = v_intent.installment_id
     AND i.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato da intenção não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  v_avulso := public.pay_avulso(
    v_investment_id,
    v_intent.amount,
    v_intent.paid_at,
    CONCAT_WS(
      ' | ',
      NULLIF(BTRIM(p_notes), ''),
      'Resolução da intenção offline ' || v_intent.id::text
    ),
    p_destination
  );

  UPDATE public.offline_payment_intents
     SET status = 'resolved',
         resolved_at = NOW()
   WHERE id = v_intent.id
     AND tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'status', 'resolved',
    'duplicada', false,
    'avulso', v_avulso
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_offline_intent_as_avulso(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_offline_intent_as_avulso(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_offline_intent_as_avulso(uuid, text, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- Descartar uma intenção por decisão explícita do dono
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.discard_offline_payment_intent(
  p_intent_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_tenant uuid;
  v_status text;
BEGIN
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL OR public.get_profile_role_safe() <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores do tenant podem descartar baixas offline.' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
    FROM public.offline_payment_intents
   WHERE id = p_intent_id
     AND tenant_id = v_tenant
   FOR UPDATE;

  -- Erros validados antes do INSERT existem apenas na fila local. `missing` é
  -- resposta idempotente e autoriza o cliente a remover esse item local.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing', 'duplicada', true);
  END IF;

  IF v_status IN ('applied', 'resolved') THEN
    RETURN jsonb_build_object('status', v_status, 'duplicada', true);
  END IF;

  UPDATE public.offline_payment_intents
     SET status = 'resolved',
         resolved_at = NOW()
   WHERE id = p_intent_id
     AND tenant_id = v_tenant;

  RETURN jsonb_build_object('status', 'resolved', 'duplicada', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.discard_offline_payment_intent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discard_offline_payment_intent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.discard_offline_payment_intent(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- Verificação: falha a migration se qualquer RPC de dinheiro reabrir para anon
-- ----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.submit_offline_payment(uuid,uuid,numeric,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'submit_offline_payment continua executável por anon';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.resolve_offline_intent_as_avulso(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'resolve_offline_intent_as_avulso continua executável por anon';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.discard_offline_payment_intent(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'discard_offline_payment_intent continua executável por anon';
  END IF;
END;
$verify$;
