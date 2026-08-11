-- ============================================================================
-- Migration v51 — endurece submit_offline_payment
-- ============================================================================
-- Quatro furos encontrados atacando a v50 de propósito:
--
-- 1. INTENÇÃO PRESA EM 'pending' TRAVAVA PARA SEMPRE. A v50 devolvia
--    {status: pending, duplicada: true} e nunca aplicava o pagamento — o
--    cobrador recebia o dinheiro, o app dizia "enviado", e nada entrava. Agora
--    'pending' é RETOMADO: a função tenta aplicar. Só 'applied' e 'resolved'
--    são terminais; 'rejected' também é retomável, porque a pendência pode ter
--    sido causada por algo que o dono já corrigiu.
--
-- 2. CORRIDA NO MESMO id. Entre o SELECT e o INSERT havia janela: dois envios
--    simultâneos passavam os dois pelo SELECT e o segundo estourava
--    unique_violation crua. Agora o INSERT trata a violação e cai no mesmo
--    caminho de retomada.
--
-- 3. ERRO TRANSITÓRIO VIRAVA REJEIÇÃO DEFINITIVA. `WHEN OTHERS` capturava
--    deadlock, serialization failure e lock timeout e marcava 'rejected' —
--    um tranco de concorrência condenava um pagamento que só precisava de
--    retry. Agora esses SQLSTATE são re-lançados: a transação desfaz, a
--    intenção não fica gravada, e o cliente reenvia.
--
-- 4. paid_at NO FUTURO era aceito (celular com relógio errado grava pagamento
--    em 2027, contaminando atraso, multa e relatório). Agora há teto de
--    tolerância de 1 dia, que cobre fuso horário sem aceitar absurdo.
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
  v_tenant  uuid;
  v_status  text;
BEGIN
  v_tenant := public.get_tenant_id_safe();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant resolvido.' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor da baixa deve ser maior que zero (recebido: %).', p_amount;
  END IF;

  -- (4) Relógio de celular erra. Um dia de tolerância cobre fuso e adiantamento
  -- de horário; além disso é dado errado, e pagamento no futuro bagunça o
  -- cálculo de atraso e de multa.
  IF p_paid_at IS NULL OR p_paid_at > NOW() + INTERVAL '1 day' THEN
    RAISE EXCEPTION 'Data do pagamento não pode estar no futuro (recebida: %).', p_paid_at;
  END IF;

  SELECT status INTO v_status
    FROM public.offline_payment_intents
   WHERE id = p_intent_id
     FOR UPDATE;

  -- (1) Só o que de fato terminou é terminal. 'pending' e 'rejected' são
  -- retomáveis — devolver "duplicada" para uma intenção pending era o que
  -- fazia o dinheiro sumir em silêncio.
  IF FOUND AND v_status IN ('applied', 'resolved') THEN
    RETURN jsonb_build_object('status', v_status, 'duplicada', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.loan_installments li
      JOIN public.investments i ON i.id = li.investment_id
     WHERE li.id = p_installment_id AND i.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Parcela não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  -- Re-consulta em vez de reaproveitar FOUND: entre o SELECT lá em cima e este
  -- ponto houve outro IF, e depender do FOUND daquele SELECT é frágil demais
  -- para um caminho que decide se um pagamento é inserido.
  IF NOT EXISTS (SELECT 1 FROM public.offline_payment_intents WHERE id = p_intent_id) THEN
    -- (2) A corrida cabe aqui: se outra transação inseriu entre o SELECT e o
    -- INSERT, seguimos para a tentativa de aplicação em vez de estourar.
    BEGIN
      INSERT INTO public.offline_payment_intents
        (id, tenant_id, installment_id, amount, paid_at, created_by)
      VALUES
        (p_intent_id, v_tenant, p_installment_id, p_amount, p_paid_at, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  -- O savepoint deste bloco é o que preserva a intenção quando o pagamento é
  -- recusado: sem ele, a falha desfaria o INSERT e apagaria o registro de um
  -- dinheiro que já está no bolso do cobrador.
  BEGIN
    PERFORM public.pay_installment(p_installment_id, p_amount, p_paid_at);
    UPDATE public.offline_payment_intents
       SET status = 'applied', error_message = NULL, resolved_at = NOW()
     WHERE id = p_intent_id;
    RETURN jsonb_build_object('status', 'applied', 'duplicada', false);
  EXCEPTION
    -- (3) Transitórios não são recusa: re-lança para o cliente reenviar. O
    -- RAISE desfaz a transação inteira, então a intenção não fica gravada.
    WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled THEN
      RAISE;
    WHEN OTHERS THEN
      UPDATE public.offline_payment_intents
         SET status = 'rejected', error_message = SQLERRM, resolved_at = NOW()
       WHERE id = p_intent_id;
      RETURN jsonb_build_object('status', 'rejected', 'erro', SQLERRM, 'duplicada', false);
  END;
END;
$function$;

-- Revogar de anon não basta: funções nascem com EXECUTE para PUBLIC e o papel
-- anon herda dali. CREATE OR REPLACE reaplica os grants padrão, então repetir.
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) TO authenticated;
