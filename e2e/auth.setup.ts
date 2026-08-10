import { test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

function writeEmptyAuth(path: string) {
  mkdirSync('e2e/.auth', { recursive: true });
  writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
}

async function loginAs(page: any, email: string, password: string, authPath: string) {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(email);
  await page.getByPlaceholder('Senha de acesso').fill(password);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });

  // Garante que o scope de empresa ativa está gravado no localStorage antes de salvar o state.
  // Sem isso, hydrateCompanyScope retorna 'all' (modo agregado) em tenants com trial ativo,
  // e muitas views E2E falham por não ter activeCompanyId definido.
  await page.evaluate(async () => {
    const env = (window as any)._env_ || {};
    const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
    if (!url || !anon) return;

    // Obtém token da sessão ativa
    const sessionKey = Object.keys(localStorage).find(
      (k) => k.includes('-auth-token') || k === 'supabase.auth.token' || k === 'ef_prod_session' || k === 'ef_dev_session',
    );
    let token = anon;
    if (sessionKey) {
      try {
        const raw = localStorage.getItem(sessionKey);
        const parsed = raw ? JSON.parse(raw) : null;
        const session = parsed?.currentSession || parsed;
        token = session?.access_token || anon;
      } catch { /* usa anon */ }
    }

    // Busca profile para obter tenant_id + company_id
    try {
      const res = await fetch(`${url}/rest/v1/profiles?select=tenant_id,company_id&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const profile = Array.isArray(data) ? data[0] : null;
      if (!profile?.tenant_id) return;

      let companyId = profile.company_id;

      // Se o admin não tem company_id no profile, busca a empresa primária do tenant
      if (!companyId) {
        const compRes = await fetch(
          `${url}/rest/v1/companies?tenant_id=eq.${profile.tenant_id}&is_primary=eq.true&select=id&limit=1`,
          { headers: { apikey: anon, Authorization: `Bearer ${token}` } },
        );
        const compData = await compRes.json();
        companyId = Array.isArray(compData) ? compData[0]?.id : null;
      }

      if (companyId) {
        // Grava o scope de empresa ativa para que hydrateCompanyScope o use ao carregar
        localStorage.setItem(`EF_ACTIVE_COMPANY_SCOPE_${profile.tenant_id}`, companyId);
      }
    } catch { /* ignora erros de rede */ }
  });

  await page.context().storageState({ path: authPath });
}

// Só admin acessa a aplicação. Configure em .env.local:
// TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD

setup('authenticate as admin', async ({ page }) => {
  if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD) {
    // Em CI, admin é obrigatório — sem credenciais, o deploy deve ser bloqueado
    if (process.env.CI) {
      throw new Error(
        'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD não configurados no CI. ' +
        'Adicione esses secrets ao repositório GitHub.'
      );
    }
    console.warn('⚠️  TEST_ADMIN_EMAIL/PASSWORD não configurado — auth de admin pulado.');
    writeEmptyAuth('e2e/.auth/admin.json');
    return;
  }
  await loginAs(page, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, 'e2e/.auth/admin.json');
});
