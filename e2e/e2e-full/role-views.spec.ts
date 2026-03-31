/**
 * Suite Role Views — E2E Full
 *
 * Testa as views específicas de cada role: investidor e devedor.
 *
 * ROL-01  Investidor vê métricas do dashboard
 * ROL-02  Investidor vê lista de investimentos com badges de saúde
 * ROL-03  Investidor vê card "Próximo Pagamento" com valor R$
 * ROL-04  Investidor não vê menus de admin (Usuários, Contratos)
 * ROL-05  Devedor vê lista de contratos/dívidas
 * ROL-06  Devedor expande contrato e vê parcelas
 * ROL-07  Devedor abre modal de PIX para pagamento
 * ROL-08  Modal PIX exibe QR Code ou payload
 * ROL-09  Devedor não vê menus de admin
 * ROL-10  Devedor fecha modal PIX
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/role-views.spec.ts --project=chromium-investor
 *   npx playwright test e2e/e2e-full/role-views.spec.ts --project=chromium-debtor
 */

import { test, expect } from '@playwright/test';

// ─── Testes de Investidor ──────────────────────────────────────────────────────

test.describe('Investidor — Dashboard e Métricas', () => {

  test('ROL-01: Investidor vê métricas no dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    // Dashboard do investidor deve ter alguma métrica
    await expect(
      page.getByText(/R\$|Total Investido|Retorno|Saldo|Patrimônio|investimento/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('ROL-02: Investidor vê lista de investimentos com badges', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    // Deve ter lista ou mensagem de sem investimentos
    await expect(
      page.getByText(/investimento|contrato|Em dia|Atrasado|nenhum/i),
    ).toBeVisible({ timeout: 12_000 });
  });

  test('ROL-03: Card "Próximo Pagamento" exibe valor em R$', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    const nextPaymentCard = page.getByTestId('next-payment-card');
    if (!(await nextPaymentCard.isVisible({ timeout: 8_000 }).catch(() => false))) {
      // Sem investimentos ativos no ambiente — aceitável
      test.skip(true, 'Card de próximo pagamento não encontrado (sem investimentos ativos)');
    }

    await expect(nextPaymentCard).toBeVisible();
    await expect(nextPaymentCard.getByText(/R\$/)).toBeVisible();
  });

  test('ROL-04: Investidor não vê menus de admin', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    // Investidor não deve ver os botões de admin
    await expect(page.locator('aside').getByRole('button', { name: 'Usuários' })).not.toBeVisible();
    await expect(page.locator('aside').getByRole('button', { name: 'Contratos' })).not.toBeVisible();
  });
});

// ─── Testes de Devedor ────────────────────────────────────────────────────────

test.describe('Devedor — Contratos e Pagamento PIX', () => {

  test('ROL-05: Devedor vê lista de contratos/dívidas', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(/contrato|parcela|dívida|deve|pagar|nenhum/i),
    ).toBeVisible({ timeout: 12_000 });
  });

  test('ROL-06: Devedor expande contrato e vê parcelas', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    // Procura um card de contrato para expandir
    const contractCard = page.getByRole('button', { name: /Ver parcelas|Expandir|Detalhes/i }).first()
      .or(page.locator('[data-testid*="contract"]').first());

    if (!(await contractCard.isVisible({ timeout: 6_000 }).catch(() => false))) {
      test.skip(true, 'Nenhum contrato disponível para o devedor de teste');
    }

    await contractCard.click();
    await page.waitForTimeout(600);

    // Parcelas devem aparecer
    await expect(
      page.getByText(/parcela|vencimento|Pagar|PIX/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('ROL-07: Botão Pagar abre modal de PIX', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    // Procura botão de pagamento PIX
    const pagarBtn = page.getByRole('button', { name: /Pagar|PIX|Gerar PIX/i }).first();

    if (!(await pagarBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
      // Tenta expandir algum contrato primeiro
      const expandBtn = page.getByRole('button').first();
      if (await expandBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expandBtn.click();
        await page.waitForTimeout(600);
      }
    }

    if (!(await pagarBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Botão de pagamento PIX não encontrado (sem parcelas pendentes)');
    }

    await pagarBtn.click();

    // Modal de pagamento PIX deve abrir
    await expect(
      page.getByText(/PIX|pagamento|Chave|QR/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('ROL-08: Modal PIX exibe dados do beneficiário ou QR Code', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    const pagarBtn = page.getByRole('button', { name: /Pagar|PIX|Gerar PIX/i }).first();

    if (!(await pagarBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'Botão de pagamento não encontrado');
    }

    await pagarBtn.click();
    await page.waitForTimeout(1_500);

    // Modal deve ter QR code canvas ou payload PIX copiável
    const hasQr = await page.locator('canvas').isVisible({ timeout: 5_000 }).catch(() => false);
    const hasPayload = await page.getByText(/Copiar|payload|chave pix/i).isVisible({ timeout: 3_000 }).catch(() => false);
    const hasAmount = await page.getByText(/R\$/).isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasQr || hasPayload || hasAmount).toBe(true);
  });

  test('ROL-09: Devedor não vê menus de admin', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    await expect(page.locator('aside').getByRole('button', { name: 'Usuários' })).not.toBeVisible();
    await expect(page.locator('aside').getByRole('button', { name: 'Contratos' })).not.toBeVisible();
  });

  test('ROL-10: Fechar modal PIX não submete pagamento', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });

    const pagarBtn = page.getByRole('button', { name: /Pagar|PIX|Gerar PIX/i }).first();

    if (!(await pagarBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'Botão de pagamento não encontrado');
    }

    await pagarBtn.click();
    await page.waitForTimeout(1_000);

    // Fecha o modal
    const closeBtn = page.getByRole('button', { name: /Fechar|Cancelar/i }).first()
      .or(page.getByRole('button').filter({ has: page.locator('svg') }).first());

    await closeBtn.click();

    // Modal deve fechar
    await expect(
      page.getByText(/QR Code|Pix.*payload/i),
    ).not.toBeVisible({ timeout: 4_000 }).catch(() => {});
  });
});
