import { test, expect } from '@playwright/test';

// AUTH-01: Login com credenciais válidas
test('AUTH-01: Login com credenciais válidas redireciona ao dashboard', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_ADMIN_EMAIL || 'teste1@teste');
  await page.getByPlaceholder('Senha de acesso').fill(process.env.TEST_ADMIN_PASSWORD || 'E2eTest@2024');
  await page.getByTestId('login-btn').click();

  await expect(page.locator('aside')).toBeVisible({ timeout: 15_000 });
  await context.close();
});

// AUTH-02: Login com credenciais inválidas
test('AUTH-02: Login com credenciais inválidas exibe erro em PT-BR', async ({ browser }) => {
  // Contexto sem auth para testar login fresco
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  await page.getByPlaceholder('seu@email.com').fill('email@invalido.com');
  await page.getByPlaceholder('Senha de acesso').fill('senhaerrada');
  await page.getByTestId('login-btn').click();

  await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 8_000 });
  // Mensagem não deve estar em inglês
  await expect(page.getByTestId('error-message')).not.toContainText('Invalid login credentials');
  // Permanecer na tela de login
  await expect(page.getByTestId('login-btn')).toBeVisible();
  await context.close();
});

// AUTH-03: Botão exibe spinner durante autenticação
test('AUTH-03: Botão de login fica desabilitado durante o carregamento', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  await page.getByPlaceholder('seu@email.com').fill('test@test.com');
  await page.getByPlaceholder('Senha de acesso').fill('senha123');
  await page.getByTestId('login-btn').click();

  // Botão deve ficar desabilitado enquanto carrega
  await expect(page.getByTestId('login-btn')).toBeDisabled();
  await context.close();
});

// AUTH-04 removido: o fluxo "Ativar Conta com Convite" não existe mais (só admin acessa a app).

// AUTH-05: Troca para modo de cadastro de empresa
test('AUTH-05: Troca para modo de cadastro de empresa', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  await page.getByText('Registrar Empresa').click();
  await expect(page.getByText('Criar Organização')).toBeVisible();
  await expect(page.getByPlaceholder('Nome da Organização')).toBeVisible();
  await context.close();
});
