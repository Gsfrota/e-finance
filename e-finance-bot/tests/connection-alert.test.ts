import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fromCalls: [] as string[],
  orCalls: [] as string[],
}));

const mocks = vi.hoisted(() => ({
  getAdminProfiles: vi.fn(),
  dispatchBriefing: vi.fn(),
  sendAlertText: vi.fn(),
  sendAlertCall: vi.fn(),
  tgSendText: vi.fn(),
  logStructuredMessage: vi.fn(),
  getSupabaseClient: vi.fn(() => ({
    from: (table: string) => {
      state.fromCalls.push(table);
      const builder: any = {
        select: () => builder,
        or: (filter: string) => {
          state.orCalls.push(filter);
          return Promise.resolve({
            data: [{ tenant_id: 'tenant-a' }],
            error: null,
          });
        },
      };
      return builder;
    },
  })),
}));

vi.mock('../src/infra/runtime-clients', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  getAdminProfiles: mocks.getAdminProfiles,
  dispatchBriefing: mocks.dispatchBriefing,
}));

vi.mock('../src/channels/whatsapp-alert', () => ({
  sendAlertText: mocks.sendAlertText,
  sendAlertCall: mocks.sendAlertCall,
}));

vi.mock('../src/channels/telegram', () => ({
  sendText: mocks.tgSendText,
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: mocks.logStructuredMessage,
}));

describe('connection alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fromCalls = [];
    state.orCalls = [];
    mocks.getAdminProfiles.mockResolvedValue([]);
  });

  it('busca tenants ativos na tabela singular validada pelo banco', async () => {
    const { handleConnectionEvent } = await import('../src/alerts/connection-alert');

    await handleConnectionEvent({ owner: 'instancia-a', status: 'disconnected' });

    expect(state.fromCalls).toContain('bot_tenant_config');
    expect(state.orCalls).toContain('followup_enabled.eq.true,morning_briefing_enabled.eq.true');
  });
});
