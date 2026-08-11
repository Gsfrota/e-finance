# PWA Offline — Entrega 3: dar baixa sem rede

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for Review

> **Registro de execução (2026-08-11):** a v50 foi endurecida pelas migrations
> v51 e v52 depois dos testes adversariais. A fonte de verdade final da RPC é
> `context/migration_v52_offline_intents_atomic_ledger.sql`; o SQL v50 abaixo é
> preservado somente como histórico do plano inicial.

**Goal:** O cobrador registra o recebimento sem rede; o servidor confirma quando a conexão volta, e o que ele recusar vira pendência para decisão humana.

**Architecture:** A baixa offline é uma **intenção**, não um fato. O celular gera um UUID e guarda a intenção numa fila local; ao sincronizar, a RPC `submit_offline_payment` usa esse UUID como chave primária — reenvio não cobra duas vezes. Nenhum cálculo financeiro sai do servidor: o app confirma só o recebimento, sem recalcular saldo.

**Tech Stack:** PostgreSQL (plpgsql, RLS), Supabase RPC, localStorage via `services/cache.ts`, React 19.

**Contexto verificado (não re-investigar):**
- `pay_installment(p_installment_id uuid, p_amount_paid numeric, p_paid_at timestamptz)` — **sem chave de idempotência**. É por isso que a tabela nova existe.
- Padrão de RLS do projeto: `tenant_id = get_tenant_id_safe() AND get_profile_role_safe() = 'admin'`.
- Guarda de tenant das RPCs (v46): `IF auth.uid() IS NULL THEN RETURN` — deixa service role passar, barra usuário de outro tenant.
- Em plpgsql, `EXCEPTION WHEN OTHERS` abre savepoint: o INSERT feito **antes** do bloco sobrevive à falha de dentro dele. É isso que faz a pendência não sumir quando o pagamento é recusado.
- Máximo de 1 admin por tenant em toda a base (21 tenants com admin, nenhum com dois) — sem concorrência entre operadores.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `context/migration_v50_offline_payment_intents.sql` (existente) | Base: tabela, RLS, índices e primeira versão da RPC |
| `context/migration_v51_offline_intents_hardening.sql` (existente) | Retomada de `pending`/`rejected`, teto de data, tenant e erros transitórios |
| `context/migration_v52_offline_intents_atomic_ledger.sql` (criar) | Mutex por intenção, payload imutável, ledger atômico e RPCs de resolução |
| `e2e/contract-db/offline-intents.dbspec.ts` (criar) | 12 provas executáveis de dinheiro, idempotência, concorrência e resolução |
| `e2e/contract-db/fixture.ts` (modificar) | Rastreio, remoção e releitura obrigatória das intenções de teste |
| `services/offlineQueue.ts` (criar) | Fila local versionada: enfileirar, listar, marcar e remover |
| `tests/unit/offlineQueue.test.ts` (criar) | Testes da fila sem browser e sem banco |
| `hooks/useOfflineSync.ts` (criar) | Envio serial ao abrir, reconectar ou voltar do background |
| `tests/unit/offlineSync.test.ts` (criar) | Ordem serial, rejeições e retry de falhas transitórias |
| `components/PendingIntentsPanel.tsx` (criar) | Pendências e decisões explícitas do dono |
| `components/InstallmentDetailFlow.tsx` (modificar) | Captura offline sem alterar saldo nem emitir recibo |
| `components/AdminContracts.tsx` (modificar) | Abertura direta do contrato associado à pendência |
| `hooks/useDashboardData.ts` (modificar) | Refetch após confirmação financeira do servidor |
| `App.tsx` (modificar) | Montagem global da sincronização e da caixa de pendências |
| `e2e/regression/frontend-resilience.spec.ts` (modificar) | Fluxo offline → reconexão → envio único no navegador |
| `scripts/test-production-resilience.sh` (modificar) | Smoke pós-deploy valida a remoção de caches sem depender do nome da variável local |

---

## Task 1: Migration — tabela e RPC

**Files:**
- Create: `context/migration_v50_offline_payment_intents.sql`

- [x] **Step 1: Escrever a migration**

```sql
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

REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid, uuid, numeric, timestamptz) TO authenticated;
```

- [x] **Step 2: Pedir aprovação explícita do usuário antes de aplicar**

O CLAUDE.md é explícito: nenhuma migration é aplicada sem acordo. Apresentar o SQL e aguardar.

- [x] **Step 3: Aplicar e validar exercitando com rollback forçado**

Depois de aplicar, rodar um `DO $$ ... $$` que: envia uma intenção nova (espera `applied`), reenvia o **mesmo** id (espera `duplicada: true` e um só pagamento), e envia contra parcela já paga (espera `rejected` com a intenção preservada). Terminar com `RAISE EXCEPTION` para desfazer tudo.

Executado com uma prova mais forte e legível: migration v52 registrada no
Supabase, 12 cenários `.dbspec.ts` contra o banco real, cleanup com releitura e
consulta final retornando zero intenções residuais.

- [x] **Step 4: Commit**

```bash
git add context/migration_v50_offline_payment_intents.sql
git commit -m "feat(db): migration v50 — intenções de baixa offline com idempotência"
```

---

## Task 2: Provas executáveis no banco

**Files:**
- Create: `e2e/contract-db/offline-intents.dbspec.ts`

Seguir o padrão dos `.dbspec.ts` existentes (`e2e/contract-db/fixture.ts` recusa rodar fora do tenant de QA e confere o cleanup relendo o banco).

- [x] **Step 1: Escrever os quatro casos**

1. **Idempotência:** mesma intenção enviada duas vezes → `duplicada: true` na segunda e **um** `payment_transactions` a mais, não dois.
2. **Rejeição preserva:** intenção contra parcela já paga → status `rejected`, `error_message` preenchida, e a linha **continua existindo**.
3. **Data de campo:** `paid_at` de dois dias atrás é gravado como tal, não substituído pela data do sync.
4. **Tenant alheio:** intenção contra parcela de outro tenant → exceção, e nada gravado.

A suíte final foi ampliada para 12 casos. Além dos quatro acima, cobre retomada
de `pending` e `rejected`, imutabilidade do payload persistido, teto de data,
negação para `anon`, resolução avulsa atômica, descarte idempotente e oito
requisições simultâneas com um único efeito financeiro e uma única linha no
ledger.

- [x] **Step 2: Rodar**

Run: `npm run test:db-contract`

Expected: os 15 existentes continuam verdes + os 4 novos.

Resultado final: **27/27** testes de contrato verdes — 15 existentes + 12 novos.

- [x] **Step 3: Commit**

---

## Task 3: A fila local

**Files:**
- Create: `services/offlineQueue.ts`
- Create: `tests/unit/offlineQueue.test.ts`

- [x] **Step 1: Escrever os testes primeiro**

Cobrir: enfileirar gera UUID e persiste; listar devolve na ordem de criação; marcar como enviada remove da fila; marcar rejeitada mantém com o motivo; enfileirar duas vezes o mesmo pagamento gera **duas** intenções distintas (são dois recebimentos, não um retry).

- [x] **Step 2: Implementar sobre localStorage**

Mesma escolha da Entrega 2: os volumes são de dezenas de kB e `services/cache.ts` já provou o caminho. IndexedDB só se o volume mudar de ordem.

- [x] **Step 3: Rodar, verificar, commitar**

---

## Task 4: Envio quando a rede volta

**Files:**
- Create: `hooks/useOfflineSync.ts`

- [x] **Step 1: Implementar o disparo**

Dispara no evento `online`, ao abrir o app e ao voltar do background. Envia **em série** — a ordem importa quando duas baixas caem na mesma parcela. Cada resposta atualiza a fila pelo `status` devolvido.

- [x] **Step 2: Montar no shell (`App.tsx`), ao lado do `OfflineBanner`**

- [x] **Step 3: Verificar com `setOffline(true)` → baixa → `setOffline(false)` → confirmar que subiu**

---

## Task 5: Caixa de pendências

**Files:**
- Create: `components/PendingIntentsPanel.tsx`

- [x] **Step 1: Listar as intenções `rejected` com o motivo em português**

- [x] **Step 2: Três ações, todas explícitas do dono:** lançar como avulso (`pay_avulso`), descartar (`status = 'resolved'`), ou abrir o contrato para resolver na mão. Nenhuma é automática.

- [x] **Step 3: Verificar, commitar**

---

## Definition of Done

- [x] Baixa registrada offline sobe sozinha quando a rede volta.
- [x] Reenvio da mesma intenção **não** cobra duas vezes — provado no banco, não presumido.
- [x] Baixa recusada aparece na caixa de pendências com o motivo.
- [x] `paid_at` é a data do recebimento em campo.
- [x] Pagamento, ledger e mudança para `applied` são atômicos.
- [x] `anon` não executa nenhuma das três RPCs financeiras da fila.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:unit`, `npm run test:db-contract` e `npm run build` verdes.

### Evidências finais

- Supabase: `v52_offline_intents_atomic_ledger` aplicada em
  `enzgerrnlbiojkuzeilw` em 2026-08-11.
- Banco: 4 arquivos e 27 testes de contrato verdes; zero intenções deixadas pelo
  teardown.
- Frontend: 74 testes unitários e 6 cenários Playwright verdes.
- Estáticos: lint, typecheck, build e `git diff --check` verdes.
- Limitação conhecida: deadlock, serialization failure e lock timeout não são
  reproduzíveis por requests isolados do PostgREST; os SQLSTATEs são
  explicitamente relançados pela função para retry técnico.

## Fora do escopo

- Qualquer escrita offline além da baixa (contrato, edição, estorno, avulso).
- Mostrar saldo recalculado offline — decisão registrada na spec: a baixa offline confirma só o recebimento.
- Múltiplos cobradores simultâneos.
- `navigator.storage.persist()` e o alarme de pendência antiga: entram aqui se a fila se provar frágil no uso real; hoje a janela declarada é de menos de 24h.
