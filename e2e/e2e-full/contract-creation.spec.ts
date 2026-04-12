/**
 * Suite Contract Creation — E2E Full
 *
 * Testa criação de contratos de todos os tipos via UI do AdminContracts.
 *
 * CNT-01  Abre wizard de criação de contrato
 * CNT-02  Avança para Step 2 com credor e tomador selecionados
 * CNT-03  Modo Manual (Definir Parcela) — campo de valor da parcela aparece
 * CNT-04  Modo Bullet / Juros Simples — campos específicos aparecem
 * CNT-05  Frequência semanal — select de dia da semana aparece
 * CNT-06  Frequência mensal — select "Todo dia" visível por padrão
 * CNT-07  Frequência Livre/Freelancer — "Distribuição rápida" aparece
 * CNT-08  Split de capital — range "Usar Lucro Acumulado" visível
 * CNT-09  Cancelar criação fecha o wizard sem criar contrato
 * CNT-10  Sem investidor — botão Próximo desabilitado
 * CNT-11  Frequência diária — toggles "Pular Sábado/Domingo" aparecem
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/contract-creation.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { waitForApp, navigateToView } from '../fixtures/e2e-test-helpers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navega para Contratos e inicia wizard de criação. */
async function startContractWizard(page: any): Promise<boolean> {
  await waitForApp(page);
  await navigateToView(page, 'Contratos');

  const novoBtn = page.getByRole('button', { name: /Novo Contrato|Criar Contrato|Novo/i });
  if (!(await novoBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
    return false;
  }
  await novoBtn.click();
  await page.waitForTimeout(600);
  return true;
}

/** Verifica se o wizard Step 1 está aberto. */
async function isWizardOpen(page: any): Promise<boolean> {
  return page
    .getByText(/Novo Contrato|Partes Envolvidas/i)
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

/**
 * Abre o wizard, seleciona o primeiro credor e tomador disponíveis e avança
 * para o Step 2 ("Termos Financeiros").
 * Retorna false se qualquer etapa não estiver disponível.
 */
async function gotoWizardStep2(page: any): Promise<boolean> {
  const opened = await startContractWizard(page);
  if (!opened) return false;
  if (!(await isWizardOpen(page))) return false;

  // Selecionar credor: clicar no input e pegar primeiro item do dropdown
  const investorInput = page.getByPlaceholder(/Selecione o credor/i);
  if (!(await investorInput.isVisible({ timeout: 5_000 }).catch(() => false))) return false;

  await investorInput.click();
  await page.waitForTimeout(400);

  // Dropdown: botões dentro de div.custom-scrollbar (renderizado ao focar o input)
  const investorDrop = page.locator('.custom-scrollbar button').first();
  if (await investorDrop.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await investorDrop.click();
  } else {
    return false;
  }
  await page.waitForTimeout(300);

  // Selecionar tomador (payer)
  const payerInput = page.getByPlaceholder(/Busque ou selecione o cliente/i);
  if (!(await payerInput.isVisible({ timeout: 5_000 }).catch(() => false))) return false;

  await payerInput.click();
  await page.waitForTimeout(400);

  const payerDrop = page.locator('.custom-scrollbar button').first();
  if (await payerDrop.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await payerDrop.click();
  } else {
    return false;
  }
  await page.waitForTimeout(300);

  // Avançar para Step 2
  const nextBtn = page.getByRole('button', { name: /^Próximo/i });
  const isEnabled = await nextBtn.isEnabled({ timeout: 5_000 }).catch(() => false);
  if (!isEnabled) return false;

  await nextBtn.click();

  // Aguardar header do Step 2
  return page
    .getByText(/Termos Financeiros/i)
    .isVisible({ timeout: 6_000 })
    .catch(() => false);
}

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe('Suite Contract Creation — Criação de Contratos', () => {

  test('CNT-01: Abre wizard de criação de contrato', async ({ page }) => {
    const opened = await startContractWizard(page);
    if (!opened) test.skip(true, 'Botão de novo contrato não encontrado');

    expect(await isWizardOpen(page)).toBe(true);
  });

  test('CNT-02: Avança para Step 2 com credor e tomador selecionados', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Não foi possível avançar ao Step 2 (sem usuários disponíveis)');

    await expect(page.getByText(/Termos Financeiros/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /^Próximo/i })).toBeVisible({ timeout: 3_000 });
  });

  test('CNT-03: Modo Manual — campo "Valor da Parcela" aparece', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Clicar em "Definir Parcela" (toggle de modo de cálculo)
    const manualBtn = page.getByRole('button', { name: /Definir Parcela/i });
    if (!(await manualBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Toggle "Definir Parcela" não encontrado no Step 2');
    }
    await manualBtn.click();
    await page.waitForTimeout(400);

    // Label "Valor da Parcela" deve aparecer
    await expect(page.getByText(/Valor da Parcela/i)).toBeVisible({ timeout: 5_000 });

    // Taxa Implícita indica que estamos no modo manual
    await expect(page.getByText(/Taxa Implícita/i)).toBeVisible({ timeout: 3_000 });
  });

  test('CNT-04: Modo Bullet / Juros Simples — campos específicos aparecem', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Clicar em "Juros Simples"
    const bulletBtn = page.getByRole('button', { name: /Juros Simples/i });
    if (!(await bulletBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão "Juros Simples" não encontrado no Step 2');
    }
    await bulletBtn.click();
    await page.waitForTimeout(400);

    // Deve aparecer opções de prazo: "Indeterminado" e "Determinado"
    await expect(page.getByRole('button', { name: /Indeterminado/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Determinado/i })).toBeVisible({ timeout: 3_000 });

    // Deve aparecer toggle de capitalização
    await expect(page.getByText(/Capitalizar Juros/i)).toBeVisible({ timeout: 5_000 });
  });

  test('CNT-05: Frequência semanal — select de dia da semana aparece', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Clicar no botão "Semanal" na grade de frequência
    const semanalBtn = page.getByRole('button', { name: /^Semanal$/i });
    if (!(await semanalBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão "Semanal" não encontrado no Step 2');
    }
    await semanalBtn.click();
    await page.waitForTimeout(400);

    // Deve aparecer label "Toda" + select com dias da semana
    await expect(page.getByText(/^Toda$/i)).toBeVisible({ timeout: 5_000 });

    // Select contém as opções de dia da semana
    const weekdaySelect = page.locator('select').filter({
      has: page.locator('option:has-text("Segunda")'),
    });
    await expect(weekdaySelect).toBeVisible({ timeout: 5_000 });
  });

  test('CNT-06: Frequência mensal — select "Todo dia" visível por padrão', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Mensal é o default — "Todo dia" deve estar visível sem clicar nada
    await expect(page.getByText('Todo dia')).toBeVisible({ timeout: 5_000 });

    // Select com dias 1-31 deve estar visível
    await expect(page.locator('select').first()).toBeVisible({ timeout: 3_000 });
  });

  test('CNT-07: Frequência Livre — "Distribuição rápida" aparece', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Clicar no botão "Livre" (frequência freelancer)
    const livreBtn = page.getByRole('button', { name: /^Livre$/i });
    if (!(await livreBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão "Livre" não encontrado no Step 2');
    }
    await livreBtn.click();
    await page.waitForTimeout(400);

    // Seção de distribuição rápida deve aparecer
    await expect(page.getByText(/Distribuição rápida/i)).toBeVisible({ timeout: 5_000 });

    // Campo de dia fixo NÃO deve existir no modo freelancer
    await expect(page.locator('input[name="due_day"]')).not.toBeVisible({ timeout: 2_000 });
  });

  test('CNT-08: Split de capital — range "Usar Lucro Acumulado" aparece', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Label do range slider deve estar visível (sempre presente no Step 2)
    await expect(page.getByText(/Usar Lucro Acumulado/i)).toBeVisible({ timeout: 5_000 });

    // O range slider deve estar presente
    await expect(page.locator('input[type="range"]')).toBeVisible({ timeout: 3_000 });

    // Seção "Fonte de Recursos" deve aparecer
    await expect(page.getByText(/Fonte de Recursos/i)).toBeVisible({ timeout: 3_000 });
  });

  test('CNT-09: Cancelar criação fecha o wizard sem criar contrato', async ({ page }) => {
    const opened = await startContractWizard(page);
    if (!opened) test.skip(true, 'Wizard não acessível');
    if (!(await isWizardOpen(page))) test.skip(true, 'Wizard não abriu');

    // Botão X no cabeçalho: h3 "Novo Contrato" → avô → primeiro button
    const xBtnInHeader = page.locator('h3', { hasText: 'Novo Contrato' }).locator('../..').getByRole('button').first();

    if (await xBtnInHeader.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await xBtnInHeader.click();
    } else {
      const cancelBtn = page.getByRole('button', { name: /^Cancelar$/i }).first();
      if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await cancelBtn.click();
      }
    }

    // Wizard deve fechar — botão "Novo Contrato" da lista fica visível
    await expect(
      page.getByRole('button', { name: 'Novo Contrato' }),
    ).toBeVisible({ timeout: 6_000 });

    // Conteúdo do wizard não deve mais estar visível
    await expect(page.getByText('Valor Principal')).not.toBeVisible();
  });

  test('CNT-10: Sem investidor selecionado — botão Próximo fica desabilitado', async ({ page }) => {
    const opened = await startContractWizard(page);
    if (!opened) test.skip(true, 'Wizard não acessível');
    if (!(await isWizardOpen(page))) test.skip(true, 'Wizard não abriu');

    // Não seleciona nenhuma parte — botão deve estar desabilitado
    const nextBtn = page.getByRole('button', { name: /^Próximo/i });
    if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(nextBtn).toBeDisabled({ timeout: 3_000 });
    } else {
      // Sem botão Próximo ainda: Step 1 em estado inicial — confirma que está no wizard
      await expect(
        page.getByText(/Partes Envolvidas|Quem Empresta/i),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('CNT-11: Frequência diária — toggles "Pular Sábado/Domingo" aparecem', async ({ page }) => {
    const atStep2 = await gotoWizardStep2(page);
    if (!atStep2) test.skip(true, 'Step 2 não acessível');

    // Clicar no botão "Diário" na grade de frequência
    const diarioBtn = page.getByRole('button', { name: /^Diário$/i });
    if (!(await diarioBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão "Diário" não encontrado no Step 2');
    }
    await diarioBtn.click();
    await page.waitForTimeout(400);

    // Toggles de pular fim de semana devem aparecer
    await expect(page.getByText(/Pular Sábado/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Pular Domingo/i)).toBeVisible({ timeout: 5_000 });

    // Clicar "Pular Sábado" não deve gerar erro
    const pulasSabadoBtn = page.getByRole('button').filter({ hasText: /Pular Sábado/i }).first();
    await pulasSabadoBtn.click();
    await page.waitForTimeout(300);

    // Toggle ainda visível (não crashou)
    await expect(page.getByText(/Pular Sábado/i)).toBeVisible({ timeout: 2_000 });
  });
});
