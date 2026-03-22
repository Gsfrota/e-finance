# Configuração Frontend

## Variáveis públicas

O frontend lê a configuração pública do Supabase nesta ordem:

1. `window._env_.SUPABASE_URL` e `window._env_.SUPABASE_ANON_KEY`
2. `import.meta.env.VITE_SUPABASE_URL` e `import.meta.env.VITE_SUPABASE_ANON_KEY`
3. Em desenvolvimento local, overrides de `localStorage` para `EF_EXTERNAL_SUPABASE_URL` e `EF_EXTERNAL_SUPABASE_KEY`

`SUPABASE_KEY` ainda funciona como fallback legado no código, mas o nome oficial no browser é `SUPABASE_ANON_KEY`.

## Compatibilidade

A transição foi desenhada para não quebrar clientes já ativos:

- Ambientes novos devem publicar `SUPABASE_ANON_KEY`.
- Ambientes antigos que ainda usam `SUPABASE_KEY` continuam funcionando enquanto o fallback existir.
- O helper de perfil agora tenta `auth_user_id` primeiro e depois `id`, então perfis migrados e legados continuam válidos.

## Limpeza de sessão

No logout, o app limpa:

- cache financeiro em `localStorage` com prefixo `ef_cache_`
- `EF_THEME`
- `EF_SIDEBAR_COLLAPSED`

Em desenvolvimento local, overrides de Supabase continuam manuais para depuração e não são apagados automaticamente pelo logout.

## Observações

- Não carregar segredos reais em `window._env_` no build local.
- Para produção, a configuração deve vir do runtime do deploy.
