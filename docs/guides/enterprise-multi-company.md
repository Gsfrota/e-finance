# Guia Enterprise Multiempresa

## Conceito

- `tenant`: cliente principal, assinatura, billing, owner e segurança macro.
- `company`: empresa/filial operacional dentro do tenant.
- `Todas as empresas`: visão consolidada para leitura executiva.

No v1:
- o switcher aparece apenas para `admin`;
- admin com trial ativo ou com `empresarial` ativo pode alternar entre todas as companies do mesmo tenant;
- admin sem trial e sem `empresarial` vê o switcher bloqueado com upsell;
- investor e debtor continuam presos à própria company;
- bot e `bot_tenant_config` continuam tenant-wide.

## Onde trocar de empresa

- O switcher fica no topo do app, ao lado do card do usuário.
- Quando multiempresa está liberado, ele mostra:
  - `Todas as empresas`
  - lista das companies do tenant
  - ação `Nova empresa`
- Quando multiempresa está bloqueado, ele continua visível para admin e leva para `Configurações > Assinatura`.

## Como o admin usa

### 1. Entrar no tenant

Depois do login, o admin com multiempresa habilitado cai por padrão em `Todas as empresas`.

### 2. Ler o consolidado

No modo agregado:
- `HOME` mostra KPIs consolidados;
- `HOME` mostra breakdown por empresa;
- `DASHBOARD` agrega carteira, recebimentos e inadimplência;
- `TOP_CLIENTES` agrega ranking;
- `COLLECTION` fica em modo resumo.

### 3. Operar uma empresa específica

Ao escolher uma empresa no switcher:
- `USERS` lista e cria usuários apenas daquela company;
- `CONTRACTS` lista e cria contratos apenas daquela company;
- `LEGACY_CONTRACT` importa contrato já com `company_id`;
- `SETTINGS > Empresa` edita branding, Pix, atendimento e timezone da company ativa.

## Antes e depois por tela

### `HOME`

Antes:
- só existia visão por tenant.

Agora:
- em `Todas as empresas`, mostra consolidado + cards por company;
- em company específica, funciona como operação isolada.

### `DASHBOARD`

Antes:
- leitura sempre pelo tenant inteiro.

Agora:
- agrega quando o escopo é `all`;
- isola por `company_id` quando uma company está ativa.

### `TOP_CLIENTES`

Antes:
- ranking tenant-wide.

Agora:
- ranking agregado no modo `all`;
- ranking isolado na company ativa.

### `COLLECTION`

Antes:
- agenda operacional do tenant.

Agora:
- em `all`, exibe só resumo consolidado;
- em company específica, mantém a operação normal.

### `USERS`, `USER_DETAILS`, `CONTRACTS`, `LEGACY_CONTRACT`

Antes:
- operavam no tenant inteiro.

Agora:
- exigem uma company ativa;
- em `all`, o app bloqueia a tela e pede seleção de empresa.

### `SETTINGS`

Agora fica dividido em três níveis:
- `Empresas`: lista e cria companies do tenant;
- `Empresa`: configura a company ativa;
- `Responsável` e `Assinatura`: continuam no nível do tenant.

## O que nasce com `company_id`

Toda mutação operacional passa a carregar a company ativa:
- cliente
- convite
- contrato
- parcela
- renegociação
- cobrança

## Fallback legado

Durante o rollout:
- branding/Pix/WhatsApp/timezone ainda podem cair no `tenant` como fallback;
- tenants legados recebem uma company primária no backfill;
- só depois de validar o tráfego novo é que `company_id` vira obrigatório.

## Fim do trial sem upgrade

- a company primária continua acessível;
- companies extras permanecem armazenadas;
- `Todas as empresas` e troca para companies extras ficam bloqueadas com upsell;
- nenhum dado é apagado automaticamente.

## Checklist rápido do admin

1. Entrar no app.
2. Conferir o switcher no topo.
3. Revisar o consolidado em `Todas as empresas`.
4. Selecionar uma company específica.
5. Criar cliente/contrato nessa company.
6. Validar que dashboards e cobrança ficaram isolados.

## Referências

- schema: [context/database_schema.md](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/context/database_schema.md)
- migration: [context/migration_v28_multi_company.sql](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/context/migration_v28_multi_company.sql)
- checklist QA: [docs/qa/enterprise-multi-company-checklist.md](/Users/guilhermefrota/Desktop/claude/ssh/e-finance/docs/qa/enterprise-multi-company-checklist.md)
