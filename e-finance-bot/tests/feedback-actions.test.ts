import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseClient: vi.fn(),
  waSendText: vi.fn(),
  lastInsert: { payload: null as any },
  insertError: { value: null as any },
}));

vi.mock('../src/infra/runtime-clients', () => ({ getSupabaseClient: mocks.getSupabaseClient }));
vi.mock('../src/channels/whatsapp', () => ({ sendText: mocks.waSendText }));
vi.mock('../src/observability/logger', () => ({ logStructuredMessage: vi.fn() }));

// Supabase fake: trata from('tenants').select().eq().maybeSingle() e from('bot_feedback').insert()
function fakeDb() {
  return {
    from(table: string) {
      if (table === 'tenants') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'MD Veículos' } }) }) }),
        };
      }
      // bot_feedback
      return {
        insert: async (payload: any) => {
          mocks.lastInsert.payload = payload;
          return { error: mocks.insertError.value };
        },
      };
    },
  };
}

let recordAndForwardFeedback: typeof import('../src/actions/feedback-actions').recordAndForwardFeedback;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules(); // config lê env no load → garantir módulo fresco por teste
  vi.stubEnv('SUPPORT_FORWARD_PHONE', '5585991318582');
  mocks.lastInsert.payload = null;
  mocks.insertError.value = null;
  mocks.getSupabaseClient.mockImplementation(fakeDb);
  ({ recordAndForwardFeedback } = await import('../src/actions/feedback-actions'));
});

const baseInput = {
  tenantId: 't1',
  profileId: 'p1',
  channel: 'whatsapp' as const,
  channelUserId: '5584999999999',
  senderName: 'João Lucas',
  senderPhone: '5584999999999',
  messageText: 'o sistema não está funcionando',
};

describe('feedback-actions — registrar + encaminhar', () => {
  it('encaminha ao suporte e registra com forwarded_ok=true', async () => {
    const result = await recordAndForwardFeedback(baseInput);

    expect(mocks.waSendText).toHaveBeenCalledTimes(1);
    expect(mocks.waSendText.mock.calls[0][0]).toBe('5585991318582');
    expect(mocks.waSendText.mock.calls[0][1]).toContain('o sistema não está funcionando');
    expect(result).toEqual({ recorded: true, forwarded: true });
    expect(mocks.lastInsert.payload.forwarded_ok).toBe(true);
    expect(mocks.lastInsert.payload.message_text).toBe('o sistema não está funcionando');
    expect(mocks.lastInsert.payload.forwarded_to).toBe('5585991318582');
  });

  it('PERSISTE o registro mesmo se o envio ao suporte falhar (forwarded_ok=false)', async () => {
    mocks.waSendText.mockRejectedValueOnce(new Error('uazapi down'));

    const result = await recordAndForwardFeedback(baseInput);

    expect(result.forwarded).toBe(false);
    expect(result.recorded).toBe(true); // registro não se perde
    expect(mocks.lastInsert.payload.forwarded_ok).toBe(false);
  });

  it('sem SUPPORT_FORWARD_PHONE: não envia, mas registra (forwarded_ok=false)', async () => {
    vi.stubEnv('SUPPORT_FORWARD_PHONE', '');
    vi.resetModules();
    ({ recordAndForwardFeedback } = await import('../src/actions/feedback-actions'));

    const result = await recordAndForwardFeedback(baseInput);

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.forwarded).toBe(false);
    expect(result.recorded).toBe(true);
    expect(mocks.lastInsert.payload.forwarded_to).toBeNull();
  });

  it('reporta recorded=false se o insert falhar', async () => {
    mocks.insertError.value = { message: 'insert failed' };

    const result = await recordAndForwardFeedback(baseInput);

    expect(result.recorded).toBe(false);
    expect(result.forwarded).toBe(true); // envio ocorreu antes
  });
});
