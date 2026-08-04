/**
 * Testes E2E — Isolamento de dados (RLS)
 *
 * Cobertura:
 *   USR-ISO-01  BR-USR-002  JWT autenticado só lê linhas do próprio tenant
 *   USR-ISO-02  BR-USR-002  Sem JWT (anon key), RLS não devolve nem aceita nada
 *
 * Por que REST e não UI: o gate de role em App.tsx é de UI. Um usuário não-admin
 * bloqueado na tela continua com JWT válido — a barreira real contra leitura/escrita
 * indevida é a RLS do Supabase. Estes testes batem direto no PostgREST.
 *
 * Execução: --project=chromium (storageState de admin)
 */

import { test, expect } from '@playwright/test';
import { getCtx, restCall } from '../fixtures/e2e-test-helpers';

// O goto existe só para hidratar o localStorage do storageState (é de onde getCtx
// lê url/anon/token). Nenhuma asserção abaixo depende da UI.
async function ctxOrSkip(page: import('@playwright/test').Page) {
  await page.goto('/');
  const ctx = await getCtx(page);
  test.skip(!ctx?.token || ctx.token === ctx.anon, 'Sem sessão autenticada (TEST_ADMIN_* não configurado)');
  return ctx!;
}

// ─── USR-ISO-01: isolamento por tenant ───────────────────────────────────────

test('USR-ISO-01 [BR-USR-002]: RLS só devolve linhas do próprio tenant', async ({ page }) => {
  const ctx = await ctxOrSkip(page);

  const me = await restCall(ctx, `profiles?select=id,tenant_id&id=eq.${ctx.userId}&limit=1`);
  const tenantId = me?.[0]?.tenant_id;
  expect(tenantId, 'profile do usuário logado deve ter tenant_id').toBeTruthy();

  // Sem filtro de tenant na query: quem filtra é a RLS.
  let totalRows = 0;
  for (const table of ['investments', 'profiles', 'companies']) {
    const rows = await restCall(ctx, `${table}?select=id,tenant_id&limit=200`);
    expect(Array.isArray(rows), `${table} deve responder uma lista`).toBe(true);
    totalRows += rows.length;
    const foreign = rows.filter((r: any) => r.tenant_id !== tenantId);
    expect(foreign, `${table} vazou linhas de outro tenant`).toEqual([]);
  }
  // Guarda anti-teste-vazio: profiles + companies do próprio tenant nunca são zero.
  expect(totalRows, 'RLS não devolveu nenhuma linha — teste seria vácuo').toBeGreaterThan(0);
});

// ─── USR-ISO-02: sem JWT não lê nem escreve ──────────────────────────────────

test('USR-ISO-02 [BR-USR-002]: anon key sem JWT não lê nem escreve', async ({ page }) => {
  const ctx = await ctxOrSkip(page);
  const anonCtx = { ...ctx, token: ctx.anon };

  for (const table of ['investments', 'profiles', 'loan_installments']) {
    // 401/403 (throw) ou lista vazia são ambos aceitáveis — o que não pode é vir dado.
    const rows = await restCall(anonCtx, `${table}?select=id&limit=5`).catch(() => []);
    expect(rows ?? [], `${table} legível sem JWT`).toEqual([]);
  }

  // 42501 = row-level security policy violation. Casar a mensagem evita que um erro
  // de schema (coluna faltando) faça o teste passar sem provar nada sobre a RLS.
  await expect(
    restCall(anonCtx, 'investments', 'POST', { asset_name: 'E2E_RLS_PROBE', amount_invested: 1 }),
    'INSERT sem JWT deveria ser barrado pela RLS',
  ).rejects.toThrow(/42501|row-level security/i);
});
