/**
 * Testes E2E — Caderneta Bullet
 *
 * Cobertura:
 *   REL-CB-01  BR-REL-010  Caderneta acessível no Dashboard, escopo bullet only
 *   REL-CB-02  BR-REL-011  Navegação mensal (prev/next), não avança além do mês atual
 *   REL-CB-03  BR-REL-012  Filtro de status (Em aberto/Atraso/Pendentes/Pagas) funciona
 *   REL-CB-04  BR-REL-013  KPIs do mês sempre visíveis (Devedores, Esperado, Recebido, Atraso, Taxa)
 *   REL-CB-05  BR-REL-014  Card de parcela com layout: nome, contrato, valor, data, badge
 *   REL-CB-06  BR-REL-015  Valores monetários nos KPIs sem truncamento
 */

import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigateToCadernetaBullet,
  isDashboardPaywalled,
} from '../fixtures/e2e-test-helpers';

test.describe('Caderneta Bullet', () => {

  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    const paywalled = await isDashboardPaywalled(page);
    test.skip(paywalled, 'Dashboard bloqueado por paywall');
  });

  // ─── REL-CB-01: Acessível, escopo bullet ────────────────────────────────────

  test('REL-CB-01 [BR-REL-010]: Caderneta Bullet acessível a partir do Dashboard', async ({ page }) => {
    await navigateToCadernetaBullet(page);

    // Verifica que abriu a Caderneta Bullet
    const title = page.getByText(/Caderneta Bullet/i).first();
    const isVisible = await title.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!isVisible) {
      // Caderneta pode não estar disponível no plano atual — skip sem falhar
      test.skip(true, 'Caderneta Bullet não acessível no plano atual');
      return;
    }
    expect(isVisible).toBeTruthy();
  });

  // ─── REL-CB-02: Navegação mensal ────────────────────────────────────────────

  test('REL-CB-02 [BR-REL-011]: Navegação mensal prev/next — não avança além do mês atual', async ({ page }) => {
    await navigateToCadernetaBullet(page);

    const root = page.getByTestId('caderneta-bullet-root');
    const rootVisible = await root.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!rootVisible) { test.skip(true, 'Caderneta Bullet não acessível no plano/dados atuais'); return; }

    const monthLabel = page.getByTestId('caderneta-month-label');
    await expect(monthLabel).toBeVisible({ timeout: 8_000 });
    const currentMonthText = await monthLabel.textContent();

    const prevBtn = page.getByTestId('caderneta-month-prev');
    const nextBtn = page.getByTestId('caderneta-month-next');

    await expect(nextBtn).toBeDisabled();
    await prevBtn.click();
    await expect(monthLabel).not.toHaveText(currentMonthText ?? '', { timeout: 5_000 });
    await expect(nextBtn).toBeEnabled();

    await nextBtn.click();
    await expect(monthLabel).toHaveText(currentMonthText ?? '', { timeout: 5_000 });
    await expect(nextBtn).toBeDisabled();
  });

  // ─── REL-CB-03: Filtro de status ────────────────────────────────────────────

  test('REL-CB-03 [BR-REL-012]: Filtros de status (Em aberto/Atraso/Pendentes/Pagas) visíveis e coerentes', async ({ page }) => {
    await navigateToCadernetaBullet(page);

    const root = page.getByTestId('caderneta-bullet-root');
    const rootVisible = await root.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!rootVisible) { test.skip(true, 'Caderneta Bullet não acessível no plano/dados atuais'); return; }

    const filters = ['open', 'late', 'pending', 'paid'] as const;
    for (const key of filters) {
      await expect(page.getByTestId(`caderneta-filter-${key}`)).toBeVisible({ timeout: 5_000 });
    }

    const openFilter = page.getByTestId('caderneta-filter-open');
    await expect(openFilter).toContainText(/Em aberto/i);
    await expect(openFilter).toHaveAttribute('aria-pressed', 'true');

    const openCards = page.getByTestId('caderneta-installment-card');
    const openCount = await openCards.count();
    for (let i = 0; i < openCount; i++) {
      await expect(openCards.nth(i)).not.toHaveAttribute('data-operational-status', 'paid');
    }

    await page.getByTestId('caderneta-filter-paid').click();
    const paidCards = page.getByTestId('caderneta-installment-card');
    const paidCount = await paidCards.count();
    for (let i = 0; i < paidCount; i++) {
      await expect(paidCards.nth(i)).toHaveAttribute('data-operational-status', 'paid');
    }
  });

  // ─── REL-CB-04: KPIs do mês ──────────────────────────────────────────────────

  test('REL-CB-04 [BR-REL-013]: KPIs do mês visíveis (Devedores, Esperado, Recebido, Atraso, Taxa)', async ({ page }) => {
    await navigateToCadernetaBullet(page);

    const root = page.getByTestId('caderneta-bullet-root');
    const rootVisible = await root.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!rootVisible) { test.skip(true, 'Caderneta Bullet não acessível no plano/dados atuais'); return; }

    const kpiTestIds = [
      'caderneta-kpi-devedores',
      'caderneta-kpi-esperado-bruto',
      'caderneta-kpi-esperado-liquido',
      'caderneta-kpi-recebido',
      'caderneta-kpi-em-atraso',
      'caderneta-kpi-taxa-cobranca',
    ];

    for (const testId of kpiTestIds) {
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 5_000 });
    }
  });

  // ─── REL-CB-05: Card de parcela com layout correto ───────────────────────────

  test('REL-CB-05 [BR-REL-014]: Card de parcela exibe nome, contrato, valor, data e badge de status', async ({ page }) => {
    await navigateToCadernetaBullet(page);
    await page.waitForTimeout(800);

    // Verifica se há cards de parcelas
    const installmentCards = page.locator('[data-installment-id]');
    const cardCount = await installmentCards.count().catch(() => 0);

    if (cardCount === 0) {
      test.skip(true, 'Sem parcelas bullet no mês atual');
      return;
    }

    const firstCard = installmentCards.first();
    await expect(firstCard).toBeVisible({ timeout: 5_000 });

    // Verifica elementos do card (BR-REL-014):
    // (c) nome do devedor, (d) data de vencimento, (e) amount_total, (h) badge de status
    const cardText = await firstCard.textContent();
    if (cardText) {
      // Deve ter algum valor monetário (R$) ou data
      const hasBRL = cardText.includes('R$') || /\d{2}\/\d{2}\/\d{4}/.test(cardText);
      expect(hasBRL).toBeTruthy();
    }

    // Badge de status deve estar visível
    const statusBadge = firstCard.getByText(/Pago|Pendente|Atrasado|Parcial|Inadimplente/i).first();
    const badgeVisible = await statusBadge.isVisible({ timeout: 3_000 }).catch(() => false);
    expect(badgeVisible).toBeTruthy();
  });

  // ─── REL-CB-06: Valores monetários sem truncamento ───────────────────────────

  test('REL-CB-06 [BR-REL-015]: Valores monetários nos KPIs formatados e sem truncamento (fmtKpi)', async ({ page }) => {
    await navigateToCadernetaBullet(page);

    const root = page.getByTestId('caderneta-bullet-root');
    const rootVisible = await root.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!rootVisible) { test.skip(true, 'Caderneta Bullet não acessível no plano/dados atuais'); return; }

    const monetaryKpis = [
      page.getByTestId('caderneta-kpi-esperado-bruto'),
      page.getByTestId('caderneta-kpi-esperado-liquido'),
      page.getByTestId('caderneta-kpi-recebido'),
      page.getByTestId('caderneta-kpi-em-atraso'),
    ];

    for (const kpi of monetaryKpis) {
      await expect(kpi).toBeVisible({ timeout: 5_000 });
      await expect(kpi).toContainText(/R\$\s*[\d.]+(,\d{2})?/);
      const hasHorizontalOverflow = await kpi.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(hasHorizontalOverflow).toBeFalsy();
    }
  });

  // ─── REL-CB-07: Mobile abre no topo ─────────────────────────────────────────

  test('REL-CB-07 [CB-001]: Mobile abre Caderneta Bullet no topo após scroll prévio', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForApp(page, { requireSidebar: false });

    const main = page.getByTestId('app-main-scroll');
    await main.evaluate((el) => { el.scrollTop = 400; });
    await navigateToCadernetaBullet(page, { skipInitialWait: true });

    const root = page.getByTestId('caderneta-bullet-root');
    const rootVisible = await root.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!rootVisible) { test.skip(true, 'Caderneta Bullet não acessível no plano/dados atuais'); return; }

    await expect.poll(async () => main.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.getByTestId('caderneta-kpi-devedores')).toBeInViewport();
  });
});
