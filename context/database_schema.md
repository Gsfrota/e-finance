# E-Finance Database Schema

Fonte canônica do modelo de dados atual do E-Finance. Este documento descreve o estado alvo do rollout multiempresa e os pontos de compatibilidade temporária que ainda existem no app.

## Modelo de domínio

- `tenant`: workspace principal, assinatura, billing, trial e segurança macro.
- `company`: empresa operacional dentro do mesmo tenant.
- `company_id`: partição operacional para contratos, usuários operacionais, convites, cobranças, branding e dashboards.
- `Todas as empresas`: visão agregada disponível apenas para admin de tenant `empresarial`.

```text
tenant
  ├── assinatura / billing / owner / slug
  ├── bot_tenant_config
  └── companies
        ├── profiles
        ├── invites
        ├── investments
        │     ├── loan_installments
        │     ├── contract_renegotiations
        │     └── avulso_payments
        └── branding operacional
              ├── logo_url
              ├── pix_key_type
              ├── pix_key
              ├── pix_name
              ├── pix_city
              ├── support_whatsapp
              └── timezone
```

## Tabelas

### `public.tenants`

Mantém o escopo principal do cliente.

Campos relevantes:
- `id`
- `name`
- `slug`
- `owner_name`
- `owner_email`
- `plan`
- `plan_status`
- `trial_ends_at`
- `stripe_customer_id`
- `stripe_subscription_id`
- `plan_updated_at`

Campos operacionais mantidos temporariamente como fallback:
- `logo_url`
- `pix_key_type`
- `pix_key`
- `pix_name`
- `pix_city`
- `support_whatsapp`
- `timezone`

Uso atual:
- billing, trial, assinatura e owner;
- fallback transitório para branding/Pix/WhatsApp/timezone enquanto o rollout multiempresa não endurece `company_id` em 100% do tráfego.

### `public.companies`

Unidade operacional isolada abaixo do tenant.

Campos:
- `id`
- `tenant_id`
- `name`
- `logo_url`
- `pix_key_type`
- `pix_key`
- `pix_name`
- `pix_city`
- `support_whatsapp`
- `timezone`
- `is_primary`
- `created_at`
- `updated_at`

Regras:
- exatamente 1 `is_primary = true` por tenant;
- admin enterprise pode criar várias companies;
- investor/debtor pertencem a exatamente 1 company no v1;
- o bot permanece tenant-wide no v1.

### `public.profiles`

Perfis autenticados do tenant.

Campos relevantes:
- `id`
- `auth_user_id`
- `tenant_id`
- `company_id`
- `role`
- `email`
- `full_name`
- `phone_number`
- `cpf`
- `photo_url`
- `cep`
- `logradouro`
- `numero`
- `bairro`
- `cidade`
- `uf`
- `updated_at`

Regras:
- `admin` continua com alcance a todo o tenant, mas com empresa ativa no frontend;
- `investor` e `debtor` ficam presos ao próprio `company_id`.

### `public.invites`

Convites de onboarding.

Campos relevantes:
- `id`
- `tenant_id`
- `company_id`
- `code`
- `role`
- `full_name`
- `email`
- `phone_number`
- `status`
- `expires_at`
- `created_by`
- `accepted_by`

Regra:
- convites precisam carregar `company_id` para que o perfil já nasça na empresa correta.

### `public.investments`

Contrato principal.

Campos relevantes:
- `id`
- `tenant_id`
- `company_id`
- `user_id`
- `payer_id`
- `asset_name`
- `amount_invested`
- `current_value`
- `interest_rate`
- `installment_value`
- `total_installments`
- `frequency`
- `due_day`
- `weekday`
- `start_date`
- `calculation_mode`
- `source_capital`
- `source_profit`
- `parent_investment_id`
- `status`
- `original_contract_code`
- `end_date`

### `public.loan_installments`

Parcelas geradas por contrato.

Campos relevantes:
- `id`
- `investment_id`
- `tenant_id`
- `company_id`
- `number`
- `due_date`
- `amount_principal`
- `amount_interest`
- `amount_total`
- `amount_paid`
- `fine_amount`
- `interest_delay_amount`
- `status`
- `paid_at`
- `payment_method`
- `interest_payments_total`
- `missed_at`
- `deferred_from_id`
- `notes`

### `public.contract_renegotiations`

Histórico de renegociação do contrato.

Campos relevantes:
- `id`
- `investment_id`
- `tenant_id`
- `company_id`
- `renegotiated_at`
- `old_installment_value`
- `new_installment_value`
- `old_total_installments`
- `new_total_installments`
- `old_due_date`
- `new_due_date`
- `reason`
- `created_by`

### `public.avulso_payments`

Pagamentos fora da grade padrão.

Campos relevantes:
- `id`
- `investment_id`
- `tenant_id`
- `company_id`
- `amount`
- `notes`
- `paid_at`

### `public.bot_tenant_config`

Permanece tenant-level nesta etapa. Não recebe `company_id` no v1.

## Helpers SQL e RPCs afetados

### Helpers de contexto

- `get_tenant_id_safe()`
  Continua resolvendo o tenant do usuário autenticado.

- `get_profile_id_safe()`
  Resolve o `profiles.id` priorizando `auth_user_id`, com fallback legado por `id`.

- `get_profile_role_safe()`
  Resolve o papel (`admin`, `investor`, `debtor`) do profile autenticado.

- `get_company_id_safe()`
  Resolve o `company_id` do profile autenticado.

- `company_belongs_to_my_tenant(p_company_id uuid)`
  Garante que o `company_id` escolhido pertence ao mesmo tenant do usuário autenticado.

- `ensure_primary_company(p_tenant_id uuid)`
  Cria ou reutiliza a company primária de um tenant legado.

### RPCs que precisam propagar `company_id`

- `generate_invite_code(...)`
  Deve aceitar `p_company_id` opcional e gravar `company_id` no convite.

- `create_client_direct(...)`
  Deve aceitar `p_company_id` e gravar o profile já vinculado à empresa ativa.

- `create_investment_validated(...)`
  Deve aceitar `p_company_id` e propagar esse valor para `investments` e `loan_installments`.

- `create_legacy_investment(...)`
  Deve aceitar `p_company_id` e gerar contrato/parcelas legadas já dentro da company correta.

- `complete_oauth_onboarding(...)`
  Em tenants novos, deve garantir que a company primária exista e que o admin inicial receba `company_id`.

- `handle_new_user()`
  Em fluxos por convite, deve copiar `invite.company_id`; em fluxos de tenant novo, deve criar e associar a company primária.

## RLS

## Escopo tenant-only

Permanece para:
- `tenants`
- `bot_tenant_config`
- billing/trial/assinatura

## Escopo tenant + company

Passa a valer para:
- `companies`
- `profiles`
- `invites`
- `investments`
- `loan_installments`
- `contract_renegotiations`
- `avulso_payments`

## Matriz de acesso

| Papel | Leitura | Escrita |
| --- | --- | --- |
| `admin` | qualquer company do próprio tenant | qualquer company do próprio tenant |
| `investor` | apenas dados da própria company e dos próprios contratos | sem mutação administrativa |
| `debtor` | apenas dados da própria company e dos próprios contratos | sem mutação administrativa |

Regras práticas:
- `profiles`: admin vê perfis do tenant; não-admin vê no mínimo o próprio profile.
- `investments`: admin vê o tenant; investor vê contratos onde `user_id = get_profile_id_safe()`; debtor vê contratos onde `payer_id = get_profile_id_safe()`.
- `loan_installments`, `contract_renegotiations` e `avulso_payments`: seguem o mesmo filtro do contrato pai.
- `invites`: admin apenas, sempre dentro do próprio tenant e company válida.

## Telas e escopo

### Agregado (`Todas as empresas`)

Permitido:
- `HOME`
- `DASHBOARD`
- `TOP_CLIENTES`
- resumo consolidado de cobrança
- `SETTINGS > Empresas`
- `SETTINGS > Responsável`
- `SETTINGS > Assinatura`

Bloqueado até selecionar empresa:
- `USERS`
- `USER_DETAILS`
- `CONTRACTS`
- `LEGACY_CONTRACT`
- edição operacional em `SETTINGS > Empresa`

### Empresa específica

Tudo que cria ou altera operação diária deve gravar `company_id` da empresa ativa:
- cliente
- convite
- contrato
- parcela
- renegociação
- cobrança

## Índices esperados

- `idx_companies_tenant_id`
- `idx_companies_primary_per_tenant`
- `idx_profiles_tenant_company`
- `idx_invites_tenant_company`
- `idx_investments_tenant_company`
- `idx_loan_installments_tenant_company`
- `idx_contract_renegotiations_tenant_company`
- `idx_avulso_payments_tenant_company`

## Backfill seguro

Para cada tenant legado:
1. criar ou reaproveitar a company primária;
2. copiar branding operacional do tenant para a company primária;
3. preencher `company_id` em `profiles`, `invites` e `investments` quando estiver nulo;
4. preencher `loan_installments`, `contract_renegotiations` e `avulso_payments` a partir do contrato pai;
5. validar que nenhum registro operacional ficou sem `company_id`;
6. só então endurecer `NOT NULL`.

## Rollout

### Fase 1

- criar `companies`;
- adicionar `company_id` nullable;
- backfill;
- publicar o app em dual-read / dual-write;
- manter fallback operacional em `tenants`.

### Fase 2

- validar ausência de `NULL` em `company_id`;
- tornar `company_id` obrigatório;
- revisar/remover políticas tenant-only antigas que ainda deixem leitura ampla demais;
- remover fallback operacional em `tenants`.

## Referências

- migration: [context/migration_v28_multi_company.sql](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/context/migration_v28_multi_company.sql)
- guia funcional: [docs/guides/enterprise-multi-company.md](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/docs/guides/enterprise-multi-company.md)
- diferenças operacionais: [docs/guides/operational-differences.md](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/docs/guides/operational-differences.md)
- runbook: [docs/devops/deploy-runbook.md](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/docs/devops/deploy-runbook.md)
