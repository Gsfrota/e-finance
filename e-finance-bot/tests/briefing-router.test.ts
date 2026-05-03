import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllTenantsWithBriefingEnabled: vi.fn(),
  getAllTenantsWithEodAlertEnabled: vi.fn(),
  updateBriefingSentAt: vi.fn(),
  updateEodAlertSentAt: vi.fn(),
  runMorningBriefingForTenant: vi.fn(),
  isTimeWindowMatch: vi.fn(),
  runPaymentFollowupForTenant: vi.fn(),
  isWithinEodAlertWindow: vi.fn(),
  runFeaturePromotions: vi.fn(),
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getAllTenantsWithBriefingEnabled: mocks.getAllTenantsWithBriefingEnabled,
  getAllTenantsWithEodAlertEnabled: mocks.getAllTenantsWithEodAlertEnabled,
  updateBriefingSentAt: mocks.updateBriefingSentAt,
  updateEodAlertSentAt: mocks.updateEodAlertSentAt,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  runMorningBriefingForTenant: mocks.runMorningBriefingForTenant,
  isTimeWindowMatch: mocks.isTimeWindowMatch,
}));

vi.mock('../src/scheduler/payment-followup', () => ({
  runPaymentFollowupForTenant: mocks.runPaymentFollowupForTenant,
  isWithinEodAlertWindow: mocks.isWithinEodAlertWindow,
}));

vi.mock('../src/scheduler/feature-promotions', () => ({
  runFeaturePromotions: mocks.runFeaturePromotions,
}));

let router: typeof import('../src/scheduler/briefing-router').router;

beforeAll(async () => {
  vi.stubEnv('SCHEDULER_SECRET', 'scheduler-secret');
  ({ router } = await import('../src/scheduler/briefing-router'));
});

describe('briefing router — payment-followup (V44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWithinEodAlertWindow.mockReturnValue(true);
    mocks.runPaymentFollowupForTenant.mockResolvedValue({
      sent: 1,
      skipped: 0,
      skippedDuplicate: 0,
      skippedBusy: 0,
    });
  });

  it('itera tenants com eod_alert_enabled e respeita janela + cooldown', async () => {
    mocks.getAllTenantsWithEodAlertEnabled.mockResolvedValue([
      { tenant_id: 'tenant-a', eod_alert_time: '17:00', last_eod_alert_sent_at: null },
      { tenant_id: 'tenant-b', eod_alert_time: '18:00', last_eod_alert_sent_at: null },
    ]);

    const app = express();
    app.use('/scheduler', router);

    const response = await request(app)
      .post('/scheduler/payment-followup')
      .set('x-scheduler-secret', 'scheduler-secret')
      .expect(200);

    expect(mocks.getAllTenantsWithEodAlertEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.updateEodAlertSentAt).toHaveBeenCalledTimes(2);
    expect(mocks.runPaymentFollowupForTenant).toHaveBeenCalledTimes(2);
    expect(response.body).toMatchObject({ processed: 2, dispatched: 2, skippedOutOfWindow: 0, skippedCooldown: 0 });
  });

  it('pula tenant fora da janela', async () => {
    mocks.getAllTenantsWithEodAlertEnabled.mockResolvedValue([
      { tenant_id: 'tenant-a', eod_alert_time: '17:00', last_eod_alert_sent_at: null },
    ]);
    mocks.isWithinEodAlertWindow.mockReturnValue(false);

    const app = express();
    app.use('/scheduler', router);

    const response = await request(app)
      .post('/scheduler/payment-followup')
      .set('x-scheduler-secret', 'scheduler-secret')
      .expect(200);

    expect(mocks.runPaymentFollowupForTenant).not.toHaveBeenCalled();
    expect(mocks.updateEodAlertSentAt).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ processed: 1, dispatched: 0, skippedOutOfWindow: 1 });
  });

  it('respeita cooldown 23h via last_eod_alert_sent_at recente', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h atrás
    mocks.getAllTenantsWithEodAlertEnabled.mockResolvedValue([
      { tenant_id: 'tenant-a', eod_alert_time: '17:00', last_eod_alert_sent_at: recent },
    ]);

    const app = express();
    app.use('/scheduler', router);

    const response = await request(app)
      .post('/scheduler/payment-followup')
      .set('x-scheduler-secret', 'scheduler-secret')
      .expect(200);

    expect(mocks.runPaymentFollowupForTenant).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ processed: 1, dispatched: 0, skippedCooldown: 1 });
  });
});

describe('briefing router — feature-promotions (V44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aceita o cron e devolve resultado do runFeaturePromotions', async () => {
    mocks.runFeaturePromotions.mockResolvedValue({
      processed: 3, sent: 1, skippedBusy: 0, skippedIneligible: 2,
    });

    const app = express();
    app.use('/scheduler', router);

    const response = await request(app)
      .post('/scheduler/feature-promotions')
      .set('x-scheduler-secret', 'scheduler-secret')
      .expect(200);

    expect(response.body).toMatchObject({ processed: 3, sent: 1, skippedIneligible: 2 });
  });

  it('rejeita request sem secret', async () => {
    const app = express();
    app.use('/scheduler', router);

    await request(app).post('/scheduler/feature-promotions').expect(401);
  });
});
