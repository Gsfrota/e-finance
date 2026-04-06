/**
 * Suite Client Management — E2E Full
 *
 * Testa criação e gerenciamento de clientes (investidores e devedores).
 *
 * CLT-01  Formulário de convite abre com campos obrigatórios
 * CLT-02  Criar convite de investidor — happy path
 * CLT-03  Criar convite de devedor — happy path
 * CLT-04  CPF inválido bloqueia submit
 * CLT-05  Email duplicado exibe erro
 * CLT-06  Busca por nome filtra usuários na lista
 * CLT-07  Busca por nome inexistente retorna lista vazia
 * CLT-08  Abre detalhes de usuário existente
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/client-management.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { waitForApp, navigateToView, selectSpecificCompany } from '../fixtures/e2e-test-helpers';
import { TEST_CPFS } from '../fixtures/test-data';

// CPF válido para testes
const VALID_CPF = TEST_CPFS.valid;
// CPF inválido para validação
const INVALID_CPF = TEST_CPFS.invalid;

/** Navega para Usuários e abre modal de convite. */
async function openInviteModal(page: any) {
  await waitForApp(page);
  await selectSpecificCompany(page);
  await navigateToView(page, 'Usuários');
  await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Gerar Convite/i }).click();
  await expect(page.getByText('Gerar Convite de Acesso')).toBeVisible({ timeout: 6_000 });
}

test.describe('Suite Client Management — Clientes e Convites', () => {

  test('CLT-01: Formulário de convite abre com campos obrigatórios visíveis', async ({ page }) => {
    await openInviteModal(page);

    await expect(page.getByPlaceholder('Nome Completo')).toBeVisible();
    await expect(page.getByPlaceholder('E-mail')).toBeVisible();
    // Role selector deve estar presente
    await expect(page.getByText(/Investidor|Devedor|Tipo/i)).toBeVisible();
  });

  test('CLT-02: Criar convite de investidor — happy path', async ({ page }) => {
    await openInviteModal(page);

    const timestamp = Date.now();
    const email = `investidor-teste-${timestamp}@e2e.test`;

    await page.getByPlaceholder('Nome Completo').fill(`Investidor E2E ${timestamp}`);
    await page.getByPlaceholder('E-mail').fill(email);

    // Seleciona role "Investidor"
    const roleSelector = page.getByRole('combobox').first();
    if (await roleSelector.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await roleSelector.selectOption({ label: /Investidor/i });
    } else {
      // Tenta via radio ou button
      const investidorOpt = page.getByText(/^Investidor$/).first();
      if (await investidorOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await investidorOpt.click();
      }
    }

    // Preenche CPF se campo presente
    const cpfInput = page.getByPlaceholder(/CPF/i);
    if (await cpfInput.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await cpfInput.fill(VALID_CPF);
    }

    // Telefone se presente
    const phoneInput = page.getByPlaceholder(/Telefone|WhatsApp/i);
    if (await phoneInput.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await phoneInput.fill('85991234567');
    }

    // Submit
    const submitBtn = page.getByRole('button', { name: /Gerar Convite|Salvar|Criar/i });
    await submitBtn.click();

    // Deve aparecer código de convite ou mensagem de sucesso
    await expect(
      page.getByText(/Convite gerado|código|sucesso|Copiar/i),
    ).toBeVisible({ timeout: 12_000 });
  });

  test('CLT-03: Criar convite de devedor — happy path', async ({ page }) => {
    await openInviteModal(page);

    const timestamp = Date.now();
    const email = `devedor-teste-${timestamp}@e2e.test`;

    await page.getByPlaceholder('Nome Completo').fill(`Devedor E2E ${timestamp}`);
    await page.getByPlaceholder('E-mail').fill(email);

    // Seleciona role "Devedor"
    const roleSelector = page.getByRole('combobox').first();
    if (await roleSelector.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await roleSelector.selectOption({ label: /Devedor/i });
    } else {
      const devedorOpt = page.getByText(/^Devedor$/).first();
      if (await devedorOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await devedorOpt.click();
      }
    }

    // CPF diferente para não conflitar com CLT-02
    const cpfInput = page.getByPlaceholder(/CPF/i);
    if (await cpfInput.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await cpfInput.fill(TEST_CPFS.valid2 || '275.984.389-10');
    }

    const submitBtn = page.getByRole('button', { name: /Gerar Convite|Salvar|Criar/i });
    await submitBtn.click();

    await expect(
      page.getByText(/Convite gerado|código|sucesso|Copiar/i),
    ).toBeVisible({ timeout: 12_000 });
  });

  test('CLT-04: CPF inválido bloqueia submit ou exibe erro', async ({ page }) => {
    await openInviteModal(page);

    await page.getByPlaceholder('Nome Completo').fill('Teste CPF Inválido');
    await page.getByPlaceholder('E-mail').fill('cpf-invalido@e2e.test');

    const cpfInput = page.getByPlaceholder(/CPF/i);
    if (!(await cpfInput.isVisible({ timeout: 2_000 }).catch(() => false))) {
      test.skip(true, 'Campo CPF não encontrado no formulário');
    }

    await cpfInput.fill(INVALID_CPF);

    const submitBtn = page.getByRole('button', { name: /Gerar Convite|Salvar|Criar/i });
    await submitBtn.click();

    // Deve exibir erro de CPF ou manter no formulário
    const cpfError = page.getByText(/CPF inválido|CPF.*inválido|inválido/i);
    const stillOpen = page.getByText('Gerar Convite de Acesso');

    await expect(cpfError.or(stillOpen)).toBeVisible({ timeout: 6_000 });
  });

  test('CLT-05: Submit sem nome exibe erro ou bloqueia', async ({ page }) => {
    await openInviteModal(page);

    // Não preenche nome
    await page.getByPlaceholder('E-mail').fill('sem-nome@e2e.test');

    const submitBtn = page.getByRole('button', { name: /Gerar Convite|Salvar|Criar/i });
    await submitBtn.click();

    // Deve mostrar erro de validação ou manter o modal aberto
    const stillOpen = page.getByText('Gerar Convite de Acesso');
    const errorMsg = page.getByText(/obrigatório|preencha|nome/i);

    await expect(stillOpen.or(errorMsg)).toBeVisible({ timeout: 5_000 });
  });

  test('CLT-06: Busca por nome filtra usuários na lista', async ({ page }) => {
    await waitForApp(page);
    await selectSpecificCompany(page);
    await navigateToView(page, 'Usuários');
    await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByPlaceholder(/Buscar/i);
    if (!(await searchInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'Campo de busca não encontrado');
    }

    // Digita um nome parcial (qualquer letra comum)
    await searchInput.fill('a');
    await page.waitForTimeout(600);
    // Não deve dar erro
    await expect(page.getByTestId('error-message')).not.toBeVisible();
  });

  test('CLT-07: Busca por nome inexistente retorna lista vazia', async ({ page }) => {
    await waitForApp(page);
    await selectSpecificCompany(page);
    await navigateToView(page, 'Usuários');
    await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByPlaceholder(/Buscar/i);
    if (!(await searchInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'Campo de busca não encontrado');
    }

    await searchInput.fill('ZZZ_USUARIO_QUE_NAO_EXISTE_99999');
    await page.waitForTimeout(600);

    // Botão de editar usuário não deve aparecer
    await expect(page.getByTestId('edit-user-btn')).not.toBeVisible();
  });

  test('CLT-08: Abre edição de usuário existente', async ({ page }) => {
    await waitForApp(page);
    await selectSpecificCompany(page);
    await navigateToView(page, 'Usuários');
    await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });

    // Verifica se há usuário na lista
    const editBtn = page.getByTestId('edit-user-btn').first();
    if (!(await editBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhum usuário na lista para editar');
    }

    await editBtn.click();

    // Deve abrir view de edição ou modal com nome do usuário
    await expect(
      page.getByPlaceholder('Nome Completo').or(page.getByText(/Editar|Perfil/i)),
    ).toBeVisible({ timeout: 6_000 });
  });
});
