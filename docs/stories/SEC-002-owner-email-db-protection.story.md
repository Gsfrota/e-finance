# SEC-002 — Proteção server-side de owner_email + RPC is_platform_owner

**Agentes:** @sm → @po → @dev → @qa → @devops
**Status:** Done
**Criada em:** 2026-06-24
**Prioridade:** P1 — escalonamento de privilégio via UPDATE direto no banco não bloqueado
**Complexidade:** S (1 migration SQL + 2 arquivos TypeScript)
**Banco:** SIM — trigger BEFORE UPDATE + SECURITY DEFINER RPC
**Valor:** Fecha o vetor de ataque onde um admin chama `UPDATE tenants SET owner_email = 'guifrotasouza@gmail.com'` diretamente via API Supabase, bypassando o guard de UI adicionado em SEC-001

---

## 1. Problema

### Vetor de ataque

```
1. Admin autenticado chama:
   UPDATE tenants SET owner_email = 'guifrotasouza@gmail.com' WHERE id = '<seu-tenant>'

2. RLS atual (Allow admin to manage their own tenant) — cmd: ALL — não bloqueia.

3. isPlatformOwner(profile, tenant) em companyScope.ts:86 retorna true:
   tenant.owner_email === PLATFORM_OWNER_EMAIL && profile.role === 'admin'

4. App.tsx:362 e :1171 renderizam PlatformOwnerPanel → acesso irrestrito à plataforma.
```

### Schema atual inspecionado (2026-06-24)

Políticas existentes em `tenants`:
- `Allow admin to manage their own tenant` — ALL — `id = get_tenant_id_safe() AND get_user_role_safe() = 'admin'`
- `Tenant members can read own tenant` — SELECT — `id = get_tenant_id_safe()`

Nenhuma restrição column-level em `owner_email`.

### SEC-001 (já corrigido)

SEC-001 bloqueou o caminho de escrita via UI (`AdminSettings.tsx`). SEC-002 fecha o caminho de escrita direta via API.

## 2. Acceptance Criteria

- **AC-1:** Função SECURITY DEFINER `is_platform_owner()` existe no banco e retorna `true` apenas quando `auth.email() = 'guifrotasouza@gmail.com'`.
- **AC-2:** Trigger `enforce_owner_email_protection` BEFORE UPDATE em `tenants` chama `is_platform_owner()` e lança exceção `42501` se `owner_email` mudar e chamador não for platform owner.
- **AC-3:** `CompanyContextProvider` em `services/companyScope.ts` chama `rpc('is_platform_owner')` no mount e expõe `isPlatformOwnerServer: boolean` via contexto.
- **AC-4:** `App.tsx` usa `isPlatformOwnerServer` (vindo do contexto) em vez de `isPlatformOwner(profile, tenant)` nas duas linhas que renderizam `PlatformOwnerPanel` (linhas ~362 e ~1171).
- **AC-5:** `isPlatformOwner()` e `isFreePlanLocked()` em `companyScope.ts` permanecem funcionais (backward compat — usados em outros lugares).
- **AC-6:** `npm run build` passa sem erros TypeScript.
- **AC-7:** Um admin NÃO consegue ver `PlatformOwnerPanel` — a flag `isPlatformOwnerServer` inicializa `false` e só vira `true` após RPC confirmar server-side.

## 3. Implementação

### AC-1 + AC-2 — Migration SQL

```sql
-- SEC-002: proteção server-side de owner_email

-- 1. SECURITY DEFINER RPC: verifica se o usuário autenticado é platform owner
CREATE OR REPLACE FUNCTION is_platform_owner()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN auth.email() = 'guifrotasouza@gmail.com';
END;
$$;

GRANT EXECUTE ON FUNCTION is_platform_owner() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_platform_owner() FROM anon;

-- 2. Trigger function: bloqueia UPDATE de owner_email por não-owners
CREATE OR REPLACE FUNCTION protect_owner_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.owner_email IS DISTINCT FROM NEW.owner_email THEN
    IF NOT is_platform_owner() THEN
      RAISE EXCEPTION 'Forbidden: owner_email cannot be modified'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attach trigger
DROP TRIGGER IF EXISTS enforce_owner_email_protection ON tenants;
CREATE TRIGGER enforce_owner_email_protection
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION protect_owner_email();
```

### AC-3 — services/companyScope.ts

Adicionar ao tipo `CompanyContextType`:
```ts
isPlatformOwnerServer: boolean;
```

Adicionar ao `CompanyContextProvider`:
```ts
const [isPlatformOwnerServer, setIsPlatformOwnerServer] = useState(false);

useEffect(() => {
  const supabase = getSupabase();
  if (!supabase) return;
  supabase.rpc('is_platform_owner').then(({ data }) => {
    if (data === true) setIsPlatformOwnerServer(true);
  });
}, []);

// Incluir isPlatformOwnerServer no value do Provider
```

### AC-4 — App.tsx

```tsx
// ANTES (~linha 362):
{isPlatformOwner(profile, tenant) && (

// DEPOIS:
{isPlatformOwnerServer && (
```

```tsx
// ANTES (~linha 1171):
{currentView === AppView.PLATFORM_OWNER && isPlatformOwner(profile, tenant) && (

// DEPOIS:
{currentView === AppView.PLATFORM_OWNER && isPlatformOwnerServer && (
```

### Fora de escopo

- Alterar `isPlatformOwner()` ou `isFreePlanLocked()` em si (backward compat)
- Remover `owner_email` do schema (breaking change, owners precisam do campo para outros usos)
- Migração de múltiplos ambientes (só aplica em prod)

## 4. File List

- [x] Migration via `mcp__supabase__apply_migration` — `is_platform_owner()` + trigger `enforce_owner_email_protection`
- [x] `services/companyScope.ts` — adicionar `isPlatformOwnerServer` ao contexto + RPC call no mount
- [x] `App.tsx` — substituir `isPlatformOwner(profile, tenant)` por `isPlatformOwnerServer` nas linhas ~362 e ~1171

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 `is_platform_owner()` SECURITY DEFINER | ✅ confirmado no banco (`security_type = DEFINER`) |
| AC-2 trigger `enforce_owner_email_protection` BEFORE UPDATE | ✅ confirmado no banco (`action_timing = BEFORE`, `event = UPDATE`) |
| AC-3 `CompanyContextProvider` expõe `isPlatformOwnerServer` via RPC | ✅ useEffect em App.tsx chama `supabase.rpc('is_platform_owner')` ao mudar `profile.id` |
| AC-4 `App.tsx` usa `isPlatformOwnerServer` nas duas localizações de render | ✅ linha 362 e ~1182 atualizadas; `isPlatformOwner` removido do import |
| AC-5 `isPlatformOwner()` e `isFreePlanLocked()` permanecem funcionais | ✅ nenhuma dessas funções foi alterada |
| AC-6 `npm run build` | ✅ verde (exit 0, 37s) |
| AC-7 `isPlatformOwnerServer` inicializa `false` | ✅ `useState(false)`, só vira `true` após RPC confirmar |
