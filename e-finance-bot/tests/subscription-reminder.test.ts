import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantsForSubscriptionReminder: vi.fn(),
  relevantDueDate: vi.fn(),
  cycleOf: vi.fn(),
  buildSubscriptionPixBlock: vi.fn(),
  getAllBotTenantConfigs: vi.fn(),
  updateSubscriptionReminderCycle: vi.fn(),
  getAdminProfiles: vi.fn(),
  getOrCreateSession: vi.fn(),
  waSendText: vi.fn(),
  tgSendText: vi.fn(),
}));

vi.mock('../src/actions/billing-actions', () => ({
  getTenantsForSubscriptionReminder: mocks.getTenantsForSubscriptionReminder,
  relevantDueDate: mocks.relevantDueDate,
  cycleOf: mocks.cycleOf,
  buildSubscriptionPixBlock: mocks.buildSubscriptionPixBlock,
}));
vi.mock('../src/actions/bot-config-actions', () => ({
  getAllBotTenantConfigs: mocks.getAllBotTenantConfigs,
  updateSubscriptionReminderCycle: mocks.updateSubscriptionReminderCycle,
}));
vi.mock('../src/scheduler/morning-briefing', () => ({
  getAdminProfiles: mocks.getAdminProfiles,
}));
vi.mock('../src/session/session-manager', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
}));
vi.mock('../src/channels/whatsapp', () => ({ sendText: mocks.waSendText }));
vi.mock('../src/channels/telegram', () => ({ sendText: mocks.tgSendText }));

let runSubscriptionReminders: typeof import('../src/scheduler/subscription-reminder').runSubscriptionReminders;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.relevantDueDate.mockReturnValue(new Date('2026-06-28T00:00:00Z'));
  mocks.cycleOf.mockReturnValue('2026-06');
  mocks.buildSubscriptionPixBlock.mockReturnValue({ message: 'PIX aqui', copyPaste: '00020...', amount: 49.9, due: new Date() });
  mocks.getAdminProfiles.mockResolvedValue([{ id: 'p1', full_name: 'Admin', whatsapp_phone: '5511999', telegram_chat_id: null }]);
  mocks.getOrCreateSession.mockResolvedValue({ id: 's1', context: {} });
  ({ runSubscriptionReminders } = await import('../src/scheduler/subscription-reminder'));
});

describe('subscription-reminder — dedup por ciclo', () => {
  it('envia e carimba o ciclo quando ainda não notificado', async () => {
    mocks.getTenantsForSubscriptionReminder.mockResolvedValue([
      { id: 't1', name: 'Tenant', plan: 'caderneta', plan_status: 'active', subscription_due_day: 10 },
    ]);
    mocks.getAllBotTenantConfigs.mockResolvedValue([
      { tenant_id: 't1', last_subscription_reminder_cycle: null },
    ]);

    const result = await runSubscriptionReminders(new Date('2026-06-08T12:00:00Z'));

    expect(mocks.waSendText).toHaveBeenCalledTimes(1);
    expect(mocks.updateSubscriptionReminderCycle).toHaveBeenCalledWith('t1', '2026-06');
    expect(result.sent).toBe(1);
  });

  it('NÃO reenvia quando o ciclo atual já foi notificado', async () => {
    mocks.getTenantsForSubscriptionReminder.mockResolvedValue([
      { id: 't1', name: 'Tenant', plan: 'caderneta', plan_status: 'active', subscription_due_day: 10 },
    ]);
    mocks.getAllBotTenantConfigs.mockResolvedValue([
      { tenant_id: 't1', last_subscription_reminder_cycle: '2026-06' },
    ]);

    const result = await runSubscriptionReminders(new Date('2026-06-08T12:00:00Z'));

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(mocks.updateSubscriptionReminderCycle).not.toHaveBeenCalled();
    expect(result.skippedAlreadyNotified).toBe(1);
  });

  it('pula tenant fora da janela (relevantDueDate null)', async () => {
    mocks.getTenantsForSubscriptionReminder.mockResolvedValue([
      { id: 't1', name: 'Tenant', plan: 'caderneta', plan_status: 'active', subscription_due_day: 10 },
    ]);
    mocks.getAllBotTenantConfigs.mockResolvedValue([{ tenant_id: 't1', last_subscription_reminder_cycle: null }]);
    mocks.relevantDueDate.mockReturnValue(null);

    const result = await runSubscriptionReminders(new Date('2026-06-15T12:00:00Z'));

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(mocks.updateSubscriptionReminderCycle).not.toHaveBeenCalled();
    expect(result.skippedOutOfWindow).toBe(1);
  });

  it('não atropela fluxo em andamento (pendingAction → skippedBusy)', async () => {
    mocks.getTenantsForSubscriptionReminder.mockResolvedValue([
      { id: 't1', name: 'Tenant', plan: 'caderneta', plan_status: 'active', subscription_due_day: 10 },
    ]);
    mocks.getAllBotTenantConfigs.mockResolvedValue([{ tenant_id: 't1', last_subscription_reminder_cycle: null }]);
    mocks.getOrCreateSession.mockResolvedValue({ id: 's1', context: { pendingAction: 'criar_contrato' } });

    const result = await runSubscriptionReminders(new Date('2026-06-08T12:00:00Z'));

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(mocks.updateSubscriptionReminderCycle).not.toHaveBeenCalled();
    expect(result.skippedBusy).toBe(1);
  });
});
