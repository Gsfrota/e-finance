# Diferenças Operacionais e Rollout Seguro

Este documento resume o que mudou no app e o que ainda está em fase de compatibilidade.

## Mudanças relevantes

- lookup de perfil agora prioriza `auth_user_id`, com fallback legado por `profiles.id`;
- bot exige autenticação própria em `/setup` e nos webhooks;
- config pública do browser prefere `SUPABASE_ANON_KEY`;
- logout limpa cache financeiro, preferências de UI e escopo ativo de company;
- o modelo multiempresa agora pode ficar ativo por trial ou por plano `empresarial` ativo.

## O que muda para admin

### Antes

- quase toda a operação era tenant-wide;
- dashboards, usuários e contratos liam o tenant inteiro.

### Agora

- o switcher aparece só para admin;
- admin com trial ativo ou `empresarial` ativo pode operar em `Todas as empresas` ou em uma company específica;
- admin sem trial e sem `empresarial` continua vendo o switcher, mas em modo bloqueado com upsell;
- `HOME`, `DASHBOARD` e `TOP_CLIENTES` podem agregar;
- `USERS`, `USER_DETAILS`, `CONTRACTS` e `LEGACY_CONTRACT` exigem company ativa.

## O que muda para investor e debtor

- continuam sem switcher;
- enxergam só a própria company;
- o conserto de `auth_user_id` evita dashboards vazios para perfis migrados.

## Compatibilidade temporária

Ainda existe fallback para não quebrar tenants antigos:
- branding/Pix/WhatsApp/timezone podem cair no `tenant` se a company ainda não estiver materializada;
- `SUPABASE_KEY` continua aceito no frontend como legado;
- a migration `v28` é aditiva e deixa o endurecimento de `NOT NULL` para a fase 2.
- companies extras não são apagadas quando o trial expira; o bloqueio é de acesso, não de dados.

## Rollout seguro

1. Aplicar `context/migration_v28_multi_company.sql`.
2. Validar backfill de company primária por tenant.
3. Publicar o app novo.
4. Fazer smoke em `Todas as empresas` e em uma company específica.
5. Confirmar que novas mutações gravam `company_id`.
6. Só então endurecer `NOT NULL` e remover fallback de `tenant`.

## Sinais de problema

- admin com trial/enterprise ativo entra em `Todas as empresas`, mas o switcher não aparece;
- admin sem entitlement consegue trocar para company extra sem upgrade;
- `USERS` ou `CONTRACTS` aparecem vazios em uma company conhecida;
- uma criação nova entra sem `company_id`;
- totais do consolidado não batem com a soma das companies;
- branding/Pix de uma company reaproveita dados errados do tenant mesmo após salvar a company.

## Guardião do banco

- schema do Supabase não deve ser aplicado diretamente sem revisão do Claude;
- o Claude deve concordar explicitamente antes do apply;
- pós-apply, o Claude valida backfill, RLS, view e RPCs críticas.

## Regra de ouro

Não remover o legado antes de confirmar:
- backfill completo;
- app em dual-read/dual-write;
- smoke com tenant real enterprise;
- zero registros operacionais novos sem `company_id`.
