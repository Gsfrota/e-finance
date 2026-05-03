import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllBotTenantConfigs: vi.fn(),
  markFeaturePromoted: vi.fn(),
  getAdminProfiles: vi.fn(),
  getOrCreateSession: vi.fn(),
  saveMessage: vi.fn(),
  updateSessionContext: vi.fn(),
  waSendText: vi.fn(),
  tgSendText: vi.fn(),
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getAllBotTenantConfigs: mocks.getAllBotTenantConfigs,
  markFeaturePromoted: mocks.markFeaturePromoted,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  getAdminProfiles: mocks.getAdminProfiles,
}));

vi.mock('../src/session/session-manager', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
  saveMessage: mocks.saveMessage,
  updateSessionContext: mocks.updateSessionContext,
}));

vi.mock('../src/channels/whatsapp', () => ({ sendText: mocks.waSendText }));
vi.mock('../src/channels/telegram', () => ({ sendText: mocks.tgSendText }));

import { runFeaturePromotions } from '../src/scheduler/feature-promotions';

const tenDaysAgo = () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

function buildConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    tenant_id: 'tenant-a',
    morning_briefing_enabled: false,
    morning_briefing_time: '08:00',
    morning_briefing_targets: ['admin'],
    followup_enabled: true,
    followup_style: 'natural',
    whitelist_enabled: false,
    whitelist_phones: [],
    created_at: tenDaysAgo(),
    updated_at: tenDaysAgo(),
    last_briefing_sent_at: null,
    eod_alert_enabled: false,
    eod_alert_time: '17:00',
    last_eod_alert_sent_at: null,
    eod_alert_promoted_at: null,
    ...overrides,
  };
}

describe('feature-promotions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminProfiles.mockResolvedValue([
      { id: 'admin-1', full_name: 'Maria Silva', whatsapp_phone: '5511999999999', telegram_chat_id: null },
    ]);
    mocks.getOrCreateSession.mockResolvedValue({ id: 'session-1', context: {} });
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.updateSessionContext.mockResolvedValue(undefined);
    mocks.waSendText.mockResolvedValue(undefined);
    mocks.markFeaturePromoted.mockResolvedValue(undefined);
  });

  it('promove EOD pra tenant elegível e marca eod_alert_promoted_at', async () => {
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig()]);

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('aviso de fim de dia'));
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ pendingAction: 'ativar_eod_alert' }),
    );
    expect(mocks.markFeaturePromoted).toHaveBeenCalledWith('tenant-a', 'eod_alert_promoted_at');
    expect(result.sent).toBe(1);
  });

  it('NÃO promove se feature já está habilitada', async () => {
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig({ eod_alert_enabled: true })]);

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(mocks.markFeaturePromoted).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.skippedIneligible).toBe(1);
  });

  it('NÃO promove se já promoveu antes', async () => {
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig({ eod_alert_promoted_at: tenDaysAgo() })]);

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('NÃO promove tenant criado há menos de 7 dias', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig({ created_at: threeDaysAgo })]);

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('NÃO promove no mesmo dia em que enviou morning briefing', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig({ last_briefing_sent_at: oneHourAgo })]);

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('skipped_busy quando sessão já tem outro pendingAction', async () => {
    mocks.getAllBotTenantConfigs.mockResolvedValue([buildConfig()]);
    mocks.getOrCreateSession.mockResolvedValue({
      id: 'session-1',
      context: { pendingAction: 'criar_contrato' },
    });

    const result = await runFeaturePromotions();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.skippedBusy).toBe(1);
    expect(mocks.markFeaturePromoted).not.toHaveBeenCalled();
  });
});

