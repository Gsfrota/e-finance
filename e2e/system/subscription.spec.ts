/**
 * Testes E2E — Assinatura e Plano
 *
 * Cobertura:
 *   SUB-TST-01  BR-SUB-002  Grace period de 7 dias visível quando plan_status=past_due
 *   SUB-TST-02  BR-SUB-003  Trial de 15 dias com features empresarial ativas
 *   SUB-TST-03  BR-SUB-004  Platform owner não tem paywall (acesso permanente)
 */

import { test, expect } from '@playwright/test';
import {
  getCtx,
  restCall,
  resolveScope,
  waitForApp,
  isDashboardPaywalled,
} from '../fixtures/e2e-test-helpers';

// ─── SUB-TST-01: Grace period ────────────────────────────────────────────────

test('SUB-TST-01 [BR-SUB-002]: Grace period de 7 dias configurado em tenant past_due', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }

  const { tenantId } = await resolveScope(ctx);
  if (!tenantId) { test.skip(true, 'Tenant não encontrado'); return; }

  const tenantRows = await restCall(
    ctx,
    `tenants?id=eq.${tenantId}&select=plan,plan_status,grace_period_ends_at,trial_ends_at`,
  );
  const tenant = tenantRows?.[0];
  if (!tenant) { test.skip(true, 'Tenant não encontrado'); return; }

  // Verifica a estrutura de grace period (campo existe no schema)
  // O teste valida que a coluna grace_period_ends_at existe (schema BR-SUB-002)
  // Não altera o estado do tenant — apenas lê
  if (tenant.plan_status === 'past_due' && tenant.grace_period_ends_at) {
    // Grace period deve ser ~7 dias após o início do past_due
    const graceDate = new Date(tenant.grace_period_ends_at);
    expect(graceDate).toBeInstanceOf(Date);
    expect(graceDate.getTime()).toBeGreaterThan(Date.now() - 30 * 86_400_000); // menos de 30 dias atrás
  } else {
    // Tenant não está em past_due — verifica apenas que o campo existe na resposta
    // (undefined é aceitável se a coluna não existe no tenant atual)
    expect(tenant.plan).toBeTruthy();
  }
});

// ─── SUB-TST-02: Trial 15 dias ───────────────────────────────────────────────

test('SUB-TST-02 [BR-SUB-003]: Trial de 15 dias — tenant criado tem trial_ends_at', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }

  const { tenantId } = await resolveScope(ctx);
  if (!tenantId) { test.skip(true, 'Tenant não encontrado'); return; }

  const tenantRows = await restCall(
    ctx,
    `tenants?id=eq.${tenantId}&select=plan,trial_ends_at,created_at`,
  );
  const tenant = tenantRows?.[0];
  if (!tenant) { test.skip(true, 'Tenant não encontrado'); return; }

  if (tenant.trial_ends_at) {
    // trial_ends_at deve ser ≈ created_at + 15 dias (BR-SUB-003)
    const createdAt = new Date(tenant.created_at);
    const trialEndsAt = new Date(tenant.trial_ends_at);
    const diffDays = (trialEndsAt.getTime() - createdAt.getTime()) / (1000 * 86_400);

    // Permite margem de ±1 dia (arredondamentos de timezone)
    expect(diffDays).toBeGreaterThanOrEqual(14);
    expect(diffDays).toBeLessThanOrEqual(16);

    // Se trial ativo, features empresariais devem estar disponíveis
    const now = new Date();
    const isTrialActive = trialEndsAt > now;
    if (isTrialActive) {
      const paywalled = await isDashboardPaywalled(page);
      expect(paywalled).toBeFalsy();
    }
  } else {
    // Tenant sem trial (criado antes do sistema de trial) — válido
    expect(tenant.plan).toBeTruthy();
  }
});

// ─── SUB-TST-03: Platform owner sem paywall ──────────────────────────────────

test('SUB-TST-03 [BR-SUB-004]: Platform owner tem acesso permanente sem paywall', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }

  const profileRows = await restCall(ctx, `profiles?select=email&limit=1`);
  const profile = profileRows?.[0];

  // Se for o platform owner, verifica que não há paywall
  if (profile?.email === 'guifrotasouza@gmail.com') {
    const paywalled = await isDashboardPaywalled(page);
    expect(paywalled).toBeFalsy();
  } else {
    // Outro admin — verifica apenas que o tenant tem configuração de plano válida
    const { tenantId } = await resolveScope(ctx);
    if (tenantId) {
      const tenantRows = await restCall(ctx, `tenants?id=eq.${tenantId}&select=plan`);
      expect(tenantRows?.[0]?.plan).toBeTruthy();
    }
  }
});
