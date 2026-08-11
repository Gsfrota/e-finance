-- ============================================================================
-- Migration v50 — baixa offline: intenções com idempotência
-- ============================================================================
-- A baixa registrada sem rede é uma INTENÇÃO, não um fato consumado. O celular
-- gera o id ANTES de existir conexão, e é esse id que impede cobrança dupla:
-- reenvio, timeout e retry batem na chave primária e devolvem o status já
-- gravado, sem tocar em dinheiro.
--
-- A mesma tabela serve de caixa de pendências. Quando pay_installment recusa
-- (parcela já paga, contrato quitado), a intenção fica com status 'rejected' e
-- a mensagem do banco — o dinheiro existe no bolso do cobrador e quem decide o
-- destino é o dono, nunca o sistema.
--
-- Migration ADITIVA: cria tabela e função novas, não altera nada existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.offline_payment_intents (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  installment_id uuid NOT NULL REFERENCES public.loan_installments(id),
  amount         numeric NOT NULL CHECK (amount > 0),
  paid_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','applied','rejected','resolved')),
  error_message  text,
  created_by     uuid,
  submitted_at   timestamptz NOT NULL DEFAULT NOW(),
  resolved_at    timestamptz
);

COMMENT ON TABLE public.offline_payment_intents IS
  'Baixas registradas sem rede. O id vem do celular e é a chave de idempotência. Status rejected = caixa de pendências.';

CREATE INDEX IF NOT EXISTS idx_offline_intents_tenant_status
  ON public.offline_payment_intents (tenant_id, status);

ALTER TABLE public.offline_payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_intents_admin_tenant ON public.offline_payment_intents;
CREATE POLICY offline_intents_admin_tenant ON public.offline_payment_intents
  FOR ALL
  USING (tenant_id = public.get_tenant_id_safe() AND public.get_profile_role_safe() = 'admin')
  WITH CHECK (tenant_id = public.get_tenant_id_safe() AND public.get_profile_role_safe() = 'admin');

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

  -- Idempotência: já processada em envio anterior → devolve o que ficou
  -- gravado e NÃO chama pay_installment de novo.
  SELECT status INTO v_status
    FROM public.offline_payment_intents
   WHERE id = p_intent_id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', v_status, 'duplicada', true);
  END IF;

  -- A parcela tem de ser do mesmo tenant de quem está enviando.
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_installments li
      JOIN public.investments i ON i.id = li.investment_id
     WHERE li.id = p_installment_id AND i.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Parcela não pertence ao seu tenant.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.offline_payment_intents
    (id, tenant_id, installment_id, amount, paid_at, created_by)
  VALUES
    (p_intent_id, v_tenant, p_installment_id, p_amount, p_paid_at, auth.uid());

  -- O bloco abaixo abre savepoint: se pay_installment falhar, só o que está
  -- DENTRO dele é desfeito. O INSERT acima sobrevive e vira pendência — sem
  -- isso a recusa apagaria o registro de um dinheiro que já foi recebido.
  BEGIN
    PERFORM public.pay_installment(p_installment_id, p_amount, p_paid_at);
    UPDATE public.offline_payment_intents
       SET status = 'applied', resolved_at = NOW()
     WHERE id = p_intent_id;
    RETURN jsonb_build_object('status', 'applied', 'duplicada', false);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.offline_payment_intents
       SET status = 'rejected', error_message = SQLERRM, resolved_at = NOW()
     WHERE id = p_intent_id;
    RETURN jsonb_build_object('status', 'rejected', 'erro', SQLERRM, 'duplicada', false);
  END;
END;
$function$;

-- ATENÇÃO: revogar de `anon` NÃO basta. Funções nascem com EXECUTE concedido a
-- PUBLIC, e anon herda desse grant — foi assim que RPCs de dinheiro ficaram
-- abertas até a v45/v46. Revogar de PUBLIC é o que fecha de verdade.
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) TO authenticated;
