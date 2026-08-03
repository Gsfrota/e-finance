import { expect, Page, test } from '@playwright/test';

const TENANT_ID = '5e0473c9-b912-4ac3-a144-d9211bcf137d';
const COMPANY_A_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_B_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const STORAGE_KEYS = ['ef_dev_session', 'ef_prod_session'];
const TEST_SUPABASE_ORIGIN = 'https://e-finance-resilience.invalid';

const fakeJwt = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJlbWFpbCI6ImFkbWluQHRlc3QuY29tIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9',
  'fake-signature',
].join('.');

const fakeUser = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin@test.com',
  email_confirmed_at: '2024-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const fakeSession = {
  access_token: fakeJwt,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 9_999_999_999,
  refresh_token: 'fake-refresh-token',
  user: fakeUser,
};

const tenant = {
  id: TENANT_ID,
  name: 'Operação Resiliente',
  slug: 'operacao-resiliente',
  plan: 'empresarial',
  plan_status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  trial_ends_at: null,
  timezone: 'America/Sao_Paulo',
};

const profile = {
  id: USER_ID,
  auth_user_id: USER_ID,
  role: 'admin',
  tenant_id: TENANT_ID,
  company_id: COMPANY_A_ID,
  full_name: 'Admin Resiliência',
  email: fakeUser.email,
  photo_url: null,
  tenants: tenant,
};

const companies = [
  {
    id: COMPANY_A_ID,
    tenant_id: TENANT_ID,
    name: 'Empresa A',
    is_primary: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: COMPANY_B_ID,
    tenant_id: TENANT_ID,
    name: 'Empresa B',
    is_primary: false,
    created_at: '2024-01-02T00:00:00Z',
  },
];

async function fulfillJson(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) {
  const rows = Array.isArray(body) ? body.length : 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': rows ? `0-${rows - 1}/${rows}` : '*/0' },
    body: JSON.stringify(body),
  });
}

type DashboardFixture = {
  investments: Record<string, unknown>[];
  loan_installments: Record<string, unknown>[];
};

type SetupEnterpriseOptions = {
  companyA?: DashboardFixture;
  companyB?: DashboardFixture;
};

const EMPTY_DASHBOARD_FIXTURE: DashboardFixture = {
  investments: [],
  loan_installments: [],
};

async function fulfillPagedJson(
  route: Parameters<Parameters<Page['route']>[1]>[0],
  rows: Record<string, unknown>[],
) {
  const requestUrl = new URL(route.request().url());
  const rangeHeader = route.request().headers().range ?? '0-999';
  const rangeMatch = /^(\d+)-(\d+)$/.exec(rangeHeader);
  const from = Number(requestUrl.searchParams.get('offset') ?? rangeMatch?.[1] ?? 0);
  const requestedLimit = Number(requestUrl.searchParams.get('limit') ?? 0);
  const to = requestedLimit > 0
    ? from + requestedLimit - 1
    : Number(rangeMatch?.[2] ?? Math.max(rows.length - 1, 0));
  const pageRows = rows.slice(from, to + 1);
  const rangeEnd = pageRows.length > 0 ? from + pageRows.length - 1 : from;

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': pageRows.length > 0 ? `${from}-${rangeEnd}/${rows.length}` : '*/0' },
    body: JSON.stringify(pageRows),
  });
}

function buildLargeCollectionFixture(count: number): DashboardFixture {
  const investments: Record<string, unknown>[] = [];
  const loanInstallments: Record<string, unknown>[] = [];

  for (let index = 0; index < count; index += 1) {
    const investmentId = 10_000 + index;
    const payer = {
      id: `payer-stress-${index}`,
      full_name: `Cliente Stress ${String(index).padStart(4, '0')}`,
      email: `stress-${index}@example.invalid`,
      photo_url: null,
    };
    const investment = {
      id: investmentId,
      tenant_id: TENANT_ID,
      company_id: COMPANY_A_ID,
      status: 'active',
      user_id: USER_ID,
      payer_id: payer.id,
      asset_name: `Contrato Stress ${index}`,
      amount_invested: 1_000,
      current_value: 1_200,
      interest_rate: 20,
      source_capital: 1_000,
      source_profit: 0,
      total_installments: 12,
      installment_value: 100,
      calculation_mode: 'price',
      frequency: 'monthly',
      remaining_balance: 1_000,
      created_at: '2024-01-01T12:00:00.000Z',
      investor: { id: USER_ID, full_name: 'Admin Resiliência', email: fakeUser.email, role: 'admin' },
      payer,
    };

    investments.push(investment);
    loanInstallments.push({
      id: `installment-stress-${index}`,
      tenant_id: TENANT_ID,
      company_id: COMPANY_A_ID,
      investment_id: investmentId,
      number: 1,
      due_date: '2024-01-15',
      status: 'late',
      amount_total: 100,
      amount_principal: 80,
      amount_interest: 20,
      amount_paid: 0,
      fine_amount: 0,
      interest_delay_amount: 0,
      paid_at: null,
      investment: {
        ...investment,
        investor: { role: 'admin' },
      },
    });
  }

  return { investments, loan_installments: loanInstallments };
}

async function setupEmptyEnterprise(page: Page, options: SetupEnterpriseOptions = {}) {
  const unexpectedSupabaseRequests: string[] = [];
  const fixtures = {
    [COMPANY_A_ID]: options.companyA ?? EMPTY_DASHBOARD_FIXTURE,
    [COMPANY_B_ID]: options.companyB ?? EMPTY_DASHBOARD_FIXTURE,
  };

  await page.addInitScript(({ session, tenantId, companyId, storageKeys, supabaseOrigin, anonKey }) => {
    for (const storageKey of storageKeys) {
      localStorage.setItem(storageKey, JSON.stringify(session));
    }
    localStorage.setItem(`EF_ACTIVE_COMPANY_SCOPE_${tenantId}`, companyId);
    localStorage.setItem('EF_EXTERNAL_SUPABASE_URL', supabaseOrigin);
    localStorage.setItem('EF_EXTERNAL_SUPABASE_ANON_KEY', anonKey);
  }, {
    session: fakeSession,
    tenantId: TENANT_ID,
    companyId: COMPANY_A_ID,
    storageKeys: STORAGE_KEYS,
    supabaseOrigin: TEST_SUPABASE_ORIGIN,
    anonKey: fakeJwt,
  });

  // Rotas são LIFO no Playwright: o fallback entra primeiro e as específicas depois.
  // Qualquer endpoint que não seja explicitamente mockado cai neste bloqueio e reprova o teste.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const isSupabaseHost = requestUrl.hostname.includes('supabase')
      || requestUrl.origin === TEST_SUPABASE_ORIGIN;
    const isSupabaseApi = /^\/(auth|functions|realtime|rest|storage)\/v1(?:\/|$)/.test(requestUrl.pathname);

    const isUnexpectedWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());

    if ((isSupabaseHost && isSupabaseApi) || isUnexpectedWrite) {
      unexpectedSupabaseRequests.push(`${request.method()} ${requestUrl.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await fulfillJson(route, []);
  });

  await page.route('**/rest/v1/profiles*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await fulfillJson(route, [profile]);
  });

  await page.route('**/rest/v1/companies*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await fulfillJson(route, companies);
  });

  await page.route('**/rest/v1/tenants*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await fulfillJson(route, [tenant]);
  });

  for (const table of ['investments', 'loan_installments']) {
    await page.route(`**/rest/v1/${table}*`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      const companyFilter = new URL(route.request().url()).searchParams.get('company_id');
      if (companyFilter === `eq.${COMPANY_B_ID}`) {
        await new Promise((resolve) => setTimeout(resolve, 1_800));
      }
      const requestedCompanyId = companyFilter?.replace(/^eq\./, '') ?? COMPANY_A_ID;
      const fixture = fixtures[requestedCompanyId] ?? EMPTY_DASHBOARD_FIXTURE;
      await fulfillPagedJson(route, fixture[table as keyof DashboardFixture]);
    });
  }

  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    if (route.request().url().includes('/user')) return fulfillJson(route, fakeUser);
    await fulfillJson(route, fakeSession);
  });

  return unexpectedSupabaseRequests;
}

test.describe('FIX-001 — resiliência contra tela azul/vazia', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block',
  });

  test('exibe recuperação HTML quando o bundle principal não carrega', async ({ page }) => {
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const isMainBundle = pathname === '/index.tsx' || /^\/assets\/index-[^/]+\.js$/.test(pathname);
      if (isMainBundle) return route.abort('failed');
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const fallback = page.getByTestId('pre-react-fallback');
    await expect(fallback).toHaveAttribute('data-state', 'error');
    await expect(page.getByRole('heading', { name: 'Não foi possível abrir o sistema' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Limpar cache e tentar novamente' })).toBeVisible();
  });

  test('Caderneta vazia continua renderizada durante refetch de empresa', async ({ page }) => {
    const unexpectedSupabaseRequests = await setupEmptyEnterprise(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const bulletButton = page.getByRole('button', { name: /caderneta bullet/i }).first();
    await expect(bulletButton).toBeVisible({ timeout: 20_000 });
    await bulletButton.click();

    const root = page.getByTestId('caderneta-bullet-root');
    await expect(root).toBeVisible({ timeout: 12_000 });

    await page.locator('header select').selectOption(COMPANY_B_ID);
    await expect(page.getByTestId('caderneta-refreshing')).toBeVisible();

    // Regressão: antes do fix, `if (loading)` desmontava esta raiz e deixava o fundo azul.
    await expect(root).toBeVisible();
    await expect(page.getByText('Carregando caderneta…')).toHaveCount(0);

    await expect(page.getByTestId('caderneta-refreshing')).toBeHidden({ timeout: 5_000 });
    await expect(root).toBeVisible();
    expect(unexpectedSupabaseRequests).toEqual([]);
  });

  test('Dashboard vazio preserva o conteúdo durante refetch de empresa', async ({ page }) => {
    const unexpectedSupabaseRequests = await setupEmptyEnterprise(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const dashboardButton = page.getByRole('button', { name: 'Dashboard' }).first();
    await expect(dashboardButton).toBeVisible({ timeout: 20_000 });
    await dashboardButton.click();

    const heading = page.getByRole('heading', { name: 'Leitura da carteira' });
    await expect(heading).toBeVisible({ timeout: 12_000 });

    await page.locator('header select').selectOption(COMPANY_B_ID);
    await expect(page.getByTestId('dashboard-refreshing')).toBeVisible();
    await expect(heading).toBeVisible();

    await expect(page.getByTestId('dashboard-refreshing')).toBeHidden({ timeout: 5_000 });
    await expect(heading).toBeVisible();
    expect(unexpectedSupabaseRequests).toEqual([]);
  });

  test('Cobrança diária vazia preserva os cards durante refetch de empresa', async ({ page }) => {
    const unexpectedSupabaseRequests = await setupEmptyEnterprise(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const collectionButton = page.getByRole('button', { name: 'Cobranças' }).first();
    await expect(collectionButton).toBeVisible({ timeout: 20_000 });
    await collectionButton.click();

    const heading = page.getByRole('heading', { name: 'Cobrança diária' });
    const portfolioCard = page.getByText('CARTEIRA', { exact: true });
    await expect(heading).toBeVisible({ timeout: 12_000 });
    await expect(portfolioCard).toBeVisible();

    await page.locator('header select').selectOption(COMPANY_B_ID);
    await expect(page.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
    await expect(heading).toBeVisible();
    await expect(portfolioCard).toBeVisible();

    await expect(page.getByRole('button', { name: 'Atualizar' })).toBeEnabled({ timeout: 5_000 });
    await expect(portfolioCard).toBeVisible();
    expect(unexpectedSupabaseRequests).toEqual([]);
  });

  test('Cobranças mantém a tela responsiva com 1.500 parcelas e limita o DOM', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const unexpectedSupabaseRequests = await setupEmptyEnterprise(page, {
      companyA: buildLargeCollectionFixture(1_500),
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const collectionButton = page.getByRole('button', { name: 'Cobranças' }).first();
    await expect(collectionButton).toBeVisible({ timeout: 20_000 });
    await collectionButton.click();

    const root = page.getByTestId('daily-collection-root');
    const cards = page.getByTestId('daily-collection-card');
    await expect(root).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('daily-collection-count')).toHaveText('Exibindo 75 de 1500 cobranças');
    await expect(cards).toHaveCount(75);

    await page.getByRole('button', { name: 'Carregar mais cobranças' }).click();
    await expect(page.getByTestId('daily-collection-count')).toHaveText('Exibindo 150 de 1500 cobranças');
    await expect(cards).toHaveCount(150);

    const search = page.getByPlaceholder('Buscar cliente...');
    await search.fill('Cliente Stress 1499');
    await expect(page.getByText('Cliente Stress 1499', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(cards).toHaveCount(1);
    await expect(root).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(unexpectedSupabaseRequests).toEqual([]);
  });
});
