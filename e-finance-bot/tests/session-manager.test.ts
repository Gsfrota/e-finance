import { beforeEach, describe, expect, it, vi } from 'vitest';

function createSupabaseMockForSessionConflict() {
  let selectCount = 0;

  const client = {
    from: (table: string) => {
      if (table !== 'bot_sessions') throw new Error(`Unexpected table ${table}`);

      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          selectCount += 1;
          if (selectCount === 1) {
            return { data: null, error: null };
          }
          return {
            data: { id: 'session-existing', profile_id: null, context: {} },
            error: null,
          };
        },
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };

      return builder;
    },
  };

  return client;
}

describe('session-manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('reaproveita a sessão vencedora quando insert perde corrida por conflito único', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => createSupabaseMockForSessionConflict(),
    }));
    vi.doMock('../src/observability/logger', () => ({
      logStructuredMessage: vi.fn(),
    }));

    const { getOrCreateSession } = await import('../src/session/session-manager');
    const session = await getOrCreateSession('telegram', 'chat-1');

    expect(session.id).toBe('session-existing');
    expect(session.channel_user_id).toBe('chat-1');
  });

  it('mantém memória curta para sessão efêmera no mesmo processo', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(),
    }));
    vi.doMock('../src/observability/logger', () => ({
      logStructuredMessage: vi.fn(),
    }));

    const {
      __resetSessionManagerStateForTests,
      getEphemeralSessionSnapshot,
      updateSessionContext,
      saveMessage,
      getRecentMessages,
    } = await import('../src/session/session-manager');

    __resetSessionManagerStateForTests();

    const before = getEphemeralSessionSnapshot('telegram', 'chat-ephemeral', null);
    expect(before.context).toEqual({});

    await updateSessionContext(before.id, {
      pendingAction: 'marcar_pagamento',
      pendingStep: 2,
    });
    await saveMessage(before.id, 'user', 'baixar contrato 123 parcela 2');
    await saveMessage(before.id, 'assistant', 'Confirma a baixa desta parcela?');

    const after = getEphemeralSessionSnapshot('telegram', 'chat-ephemeral', null);
    const history = await getRecentMessages(after.id);

    expect(after.context).toEqual(expect.objectContaining({
      pendingAction: 'marcar_pagamento',
      pendingStep: 2,
    }));
    expect(history).toEqual([
      { role: 'user', content: 'baixar contrato 123 parcela 2' },
      { role: 'assistant', content: 'Confirma a baixa desta parcela?' },
    ]);
  });
});
