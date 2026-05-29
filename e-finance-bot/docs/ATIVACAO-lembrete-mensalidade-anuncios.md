# Ativação — Lembrete de mensalidade (PIX) + Anúncios

Tudo está **pronto e testado**. Quando o **UazAPI voltar** (estava suspenso por falta de pagamento)
e o **bot for deployado**, os disparos acontecem **sozinhos**, sem reenvio duplicado.

## ✅ Já feito (banco — produção `enzgerrnlbiojkuzeilw`)

- `tenants.subscription_due_day`, `bot_tenant_config.last_subscription_reminder_cycle`,
  tabelas `announcements` + `announcement_deliveries` (com `announcements.tenant_id` para piloto).
- **MD Veículos** (`5e0473c9-…137d`): `subscription_due_day = 28`, plano `caderneta`.
- **PRIMO CASH** (`75ef198f-…3c04`): `subscription_due_day = 28`, plano `caderneta`.
- Anúncio "Deixamos o Juros Certo melhor pra você" (`0dff71ce-…`) escopado a **MD Veículos**.

## ⏳ Falta (1x, no deploy — responsabilidade @devops)

### 1. Variáveis de ambiente (Secret Manager)

```
PLATFORM_PIX_KEY=45448618000157
PLATFORM_PIX_KEY_TYPE=CNPJ
PLATFORM_PIX_NAME=GRUPO SS
PLATFORM_PIX_CITY=Mossoró
SUBSCRIPTION_AMOUNT_CADERNETA=150
SUBSCRIPTION_AMOUNT_EMPRESARIAL=<definir quando houver plano empresarial>
SUBSCRIPTION_REMINDER_LEAD_DAYS=3
SUBSCRIPTION_REMINDER_GRACE_DAYS=7
```

> PIX validado (parser EMV + CRC16 OK). Confirme colando o copia-e-cola no app do banco:
> deve aparecer **GRUPO SS / R$ 150,00**.

### 2. Cloud Scheduler (2 jobs novos, POST com header `x-scheduler-secret`)

| Job | Endpoint | Frequência sugerida |
|-----|----------|---------------------|
| Lembrete de mensalidade | `POST /scheduler/subscription-reminder` | 1x/dia (ex: 09:00 BRT) |
| Anúncios | `POST /scheduler/announcements` | 1x/dia |

Rodar diário é seguro: o dedup garante **1 envio por ciclo/destinatário**.

### 3. Reconectar a instância UazAPI do bot
A instância de produção deve estar `connected` (hoje estava `disconnected`/`401`).
**Não** usar o número pessoal — usar o WhatsApp oficial do bot.

## 🧠 Inteligência do lembrete (anti-erro / anti-spam)

- **Janela:** avisa de `LEAD_DAYS` antes até `GRACE_DAYS` depois do vencimento.
  Com 28 + lead 3 + graça 7 → ativo de **25** até **~4 do mês seguinte**.
- **Em atraso:** se o dia já passou (caso atual do dia 28), a mensagem muda para o tom
  *"venceu em DD/MM (há N dias) — regularize"*, com o mesmo PIX.
- **Sem duplicar:** carimbo do ciclo `YYYY-MM` do **vencimento relevante** em
  `bot_tenant_config.last_subscription_reminder_cycle`. Cada vencimento gera no máximo
  1 lembrete, mesmo rodando o job todo dia. Atraso de maio e antecedência de junho são
  ciclos distintos → cada um sai uma vez.
- **Não atropela conversa:** se o admin tem um fluxo aberto (`pendingAction`), pula (`skippedBusy`).
- **On-demand:** o admin pode pedir "qual o pix da minha mensalidade?" a qualquer hora.

## Disparo imediato dos atuais (dia 28 já venceu)

Como hoje (29/05) está dentro da graça de 7 dias, no **primeiro run** após o deploy
MD Veículos e PRIMO CASH recebem o lembrete **em atraso** automaticamente — sem ação manual.
Se preferir antecipar manualmente 1 vez, basta um POST autenticado em
`/scheduler/subscription-reminder` após o deploy.

## Controles rápidos (SQL)

```sql
-- desligar o anúncio piloto
update public.announcements set active=false where id='0dff71ce-6f46-4b19-9257-44ba468599ea';
-- soltar anúncio pra todos os admins (global)
update public.announcements set tenant_id=null where id='0dff71ce-...';
-- forçar reenvio do lembrete de um tenant (limpa o carimbo do ciclo)
update public.bot_tenant_config set last_subscription_reminder_cycle=null where tenant_id='<tenant>';
```
