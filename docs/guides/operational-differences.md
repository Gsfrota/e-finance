# Diferenças Recentes e Operação Segura

## O Que Mudou

Esta base está em transição entre o modelo antigo e o modelo atual.

- O frontend deixa de assumir que `profiles.id === auth.users.id` e agora procura `auth_user_id` primeiro.
- O bot não aceita mais setup/webhook sem autenticação própria.
- A configuração pública do browser passou a preferir `SUPABASE_ANON_KEY`.
- O logout limpa cache financeiro e preferências locais de UI, mas não faz rotação de credenciais.

## O Que Isso Significa Para Admins

Os fluxos de `admin` e `contracts` continuam funcionando quando o banco está consistente. O ganho dessa mudança é evitar quebra silenciosa em tenants migrados, onde o perfil existe com `auth_user_id` diferente de `id`.

Na prática:

- `Admin Users` continua lendo o tenant do perfil autenticado.
- `Admin Contracts` continua usando `tenant_id` para listar e editar contratos.
- O comportamento antigo ainda existe como fallback, então tenants legados não precisam migrar de uma vez.

## O Que Isso Significa Para Investidor E Devedor

Os dashboards financeiros agora usam o `profile.id` resolvido pelo helper central, e não o `auth user id` cru.

Isso corrige casos em que:

- o usuário autentica normalmente,
- o perfil existe,
- mas a consulta financeira anterior retornava vazio porque usava a chave errada.

## Como Usar O App

- `admin`: entrar, abrir `Admin Users` ou `Admin Contracts` e operar dentro do tenant carregado no perfil.
- `investor`: abrir o dashboard e acompanhar carteira, retorno e próximas parcelas.
- `devedor`: abrir o dashboard e conferir saldo, parcelas e atrasos.
- `bot`: usar WhatsApp ou Telegram para consultas e comandos; ações sensíveis exigem confirmação explícita.

## Rollout Seguro

1. Criar e validar os secrets novos do bot antes de qualquer deploy.
2. Manter o fallback legado do frontend até todas as variáveis públicas estarem padronizadas.
3. Fazer smoke test dos fluxos `admin`, `investor` e `devedor` após o deploy.
4. Confirmar que os webhooks chegaram com autenticação válida antes de considerar o rollout concluído.
5. Rotacionar credenciais expostas fora do repositório como tarefa separada do deploy.

## Sinais De Problema

- Admin abre, mas contratos aparecem vazios para um tenant conhecido.
- O bot sobe, mas não recebe mensagens após o `/setup`.
- O frontend carrega, mas não encontra Supabase porque o runtime não injeta `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

## Regra De Ouro

Não remover o legado antes de confirmar que o novo caminho foi aplicado em todos os ambientes que usam o app.
