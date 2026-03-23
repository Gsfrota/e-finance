import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllTenantsWithBriefingEnabled: vi.fn(),
  getAllTenantsWithFollowupEnabled: vi.fn(),
  updateBriefingSentAt: vi.fn(),
  runMorningBriefingForTenant: vi.fn(),
  isTimeWindowMatch: vi.fn(),
  runPaymentFollowupForTenant: vi.fn(),
  shouldRunPaymentFollowupNow: vi.fn(),
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getAllTenantsWithBriefingEnabled: mocks.getAllTenantsWithBriefingEnabled,
  getAllTenantsWithFollowupEnabled: mocks.getAllTenantsWithFollowupEnabled,
  updateBriefingSentAt: mocks.updateBriefingSentAt,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  runMorningBriefingForTenant: mocks.runMorningBriefingForTenant,
  isTimeWindowMatch: mocks.isTimeWindowMatch,
}));

vi.mock('../src/scheduler/payment-followup', () => ({
  runPaymentFollowupForTenant: mocks.runPaymentFollowupForTenant,
  shouldRunPaymentFollowupNow: mocks.shouldRunPaymentFollowupNow,
}));

let router: typeof import('../src/scheduler/briefing-router').router;

beforeAll(async () => {
  vi.stubEnv('SCHEDULER_SECRET', 'scheduler-secret');
  ({ router } = await import('../src/scheduler/briefing-router'));
});

describe('briefing router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldRunPaymentFollowupNow.mockReturnValue(true);
    mocks.getAllTenantsWithFollowupEnabled.mockResolvedValue([
      { tenant_id: 'tenant-a' },
      { tenant_id: 'tenant-b' },
    ]);
    mocks.runPaymentFollowupForTenant.mockResolvedValue({
      sent: 1,
      skipped: 0,
      skippedDuplicate: 0,
      skippedBusy: 0,
    });
  });

  it('dispara follow-up apenas para tenants com followup_enabled', async () => {
    const app = express();
    app.use('/scheduler', router);

    const response = await request(app)
      .post('/scheduler/payment-followup')
      .set('x-scheduler-secret', 'scheduler-secret')
      .expect(200);

    expect(mocks.getAllTenantsWithFollowupEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.runPaymentFollowupForTenant).toHaveBeenNthCalledWith(1, 'tenant-a');
    expect(mocks.runPaymentFollowupForTenant).toHaveBeenNthCalledWith(2, 'tenant-b');
    expect(response.body).toMatchObject({
      dispatched: 2,
      skipped: 0,
      skippedDuplicate: 0,
      skippedBusy: 0,
    });
  });
});
