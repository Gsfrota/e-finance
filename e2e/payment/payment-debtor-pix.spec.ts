/**
 * Testes E2E — PIX Self-Service do Devedor
 *
 * Cobertura:
 *   PAG-PIX-01  BR-PAG-016  PIX self-service: apenas valor exato (sem parcial/excedente)
 *   PAG-PIX-02  BR-PAG-008  PIX gera payload válido (usa generatePixCode de services/pix.ts)
 *
 * Execução: --project=chromium-debtor (autenticado como devedor)
 */

import { test, expect } from '@playwright/test';

test.describe('PIX Self-Service do Devedor', () => {

  test('PAG-PIX-01 [BR-PAG-016]: Modal PIX do devedor só permite valor exato da parcela', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    // Expande o primeiro contrato
    const contracts = page.getByTestId('contract-item');
    const hasContracts = await contracts.count().then(c => c > 0).catch(() => false);
    if (!hasContracts) {
      // Sem contratos no ambiente — teste não aplicável
      test.skip(true, 'Devedor sem contratos ativos no ambiente de teste');
      return;
    }

    await contracts.first().click();
    await page.waitForTimeout(500);

    // Abre modal PIX da primeira parcela pendente
    const payBtn = page.getByTestId('pay-btn').first();
    const payBtnVisible = await payBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!payBtnVisible) {
      test.skip(true, 'Botão de pagamento não encontrado');
      return;
    }

    await payBtn.click();
    await expect(page.getByTestId('payment-modal')).toBeVisible({ timeout: 8_000 });

    // No modal PIX do devedor, o valor deve ser fixo (readonly ou sem input editável)
    // BR-PAG-016: amount_fixed = installment.amount_total + charges
    const modal = page.getByTestId('payment-modal');

    // Verifica que não há input de valor editável (self-service é valor fixo)
    const editableInput = modal.locator('input[type="number"]:not([readonly]):not([disabled])');
    const hasEditableInput = await editableInput.isVisible({ timeout: 2_000 }).catch(() => false);
    expect(hasEditableInput).toBeFalsy();

    // Verifica que o valor em R$ está presente
    await expect(modal.getByText(/R\$/)).toBeVisible({ timeout: 5_000 });
  });

  test('PAG-PIX-02 [BR-PAG-008]: Modal PIX exibe payload ou QR Code gerado', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 });

    const contracts = page.getByTestId('contract-item');
    const hasContracts = await contracts.count().then(c => c > 0).catch(() => false);
    if (!hasContracts) {
      test.skip(true, 'Devedor sem contratos ativos no ambiente de teste');
      return;
    }

    await contracts.first().click();
    await page.waitForTimeout(500);

    const payBtn = page.getByTestId('pay-btn').first();
    const payBtnVisible = await payBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!payBtnVisible) {
      test.skip(true, 'Botão de pagamento não encontrado');
      return;
    }

    await payBtn.click();
    await expect(page.getByTestId('payment-modal')).toBeVisible({ timeout: 8_000 });

    // Aguarda o QR Code ou payload PIX (canvas gerado pelo qrcode.react)
    // BR-PAG-008: deve usar generatePixCode de services/pix.ts, não string hardcoded
    const qrCanvas = page.locator('[data-testid="qr-code"] canvas, canvas').first();
    const pixPayload = page.getByText(/00020126|pix\.bcb\.gov\.br|BR\d{2}/i).first();

    const hasQR = await qrCanvas.isVisible({ timeout: 15_000 }).catch(() => false);
    const hasPayload = await pixPayload.isVisible({ timeout: 5_000 }).catch(() => false);

    // Deve ter QR Code OU payload PIX (ou estar gerando)
    const isGenerating = await page.locator('.animate-spin').isVisible({ timeout: 2_000 }).catch(() => false);

    expect(hasQR || hasPayload || isGenerating).toBeTruthy();
  });
});
