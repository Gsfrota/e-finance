import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = {
  table: string;
  terminal: 'single' | 'maybeSingle' | 'eq' | 'is';
  result: any;
};

function createSupabaseMock(steps: Step[]) {
  let fromIndex = 0;
  const calls: Array<{ table: string; method: string; args: any[] }> = [];

  const createBuilder = (step: Step, table: string) => {
    const builder: any = {
      select: (...args: any[]) => {
        calls.push({ table, method: 'select', args });
        return builder;
      },
      update: (...args: any[]) => {
        calls.push({ table, method: 'update', args });
        return builder;
      },
      delete: (...args: any[]) => {
        calls.push({ table, method: 'delete', args });
        return builder;
      },
      insert: (...args: any[]) => {
        calls.push({ table, method: 'insert', args });
        return builder;
      },
      eq: (...args: any[]) => {
        calls.push({ table, method: 'eq', args });
        if (step.terminal === 'eq') return Promise.resolve(step.result);
        return builder;
      },
      gt: (...args: any[]) => {
        calls.push({ table, method: 'gt', args });
        return builder;
      },
      is: (...args: any[]) => {
        calls.push({ table, method: 'is', args });
        if (step.terminal === 'is') return Promise.resolve(step.result);
        return builder;
      },
      maybeSingle: () => {
        calls.push({ table, method: 'maybeSingle', args: [] });
        if (step.terminal !== 'maybeSingle') throw new Error(`Unexpected maybeSingle for ${table}`);
        return Promise.resolve(step.result);
      },
      single: () => {
        calls.push({ table, method: 'single', args: [] });
        if (step.terminal !== 'single') throw new Error(`Unexpected single for ${table}`);
        return Promise.resolve(step.result);
      },
    };

    return builder;
  };

  const client = {
    from: (table: string) => {
      const step = steps[fromIndex++];
      if (!step) throw new Error(`Unexpected from(${table})`);
      if (step.table !== table) {
        throw new Error(`Expected from(${step.table}) but got from(${table})`);
      }
      return createBuilder(step, table);
    },
    rpc: vi.fn(),
  };

  return {
    client,
    calls,
    assertAllStepsUsed() {
      expect(fromIndex).toBe(steps.length);
    },
  };
}

describe('tenant isolation hotfix', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('validateLinkCode retorna conflito quando canal já está vinculado a outro profile', async () => {
    const mock = createSupabaseMock([
      {
        table: 'bot_link_codes',
        terminal: 'single',
        result: {
          data: { id: 'code-1', profile_id: 'profile-b', profiles: { full_name: 'Conta B' } },
          error: null,
        },
      },
      {
        table: 'profiles',
        terminal: 'maybeSingle',
        result: {
          data: { id: 'profile-a', full_name: 'Conta A' },
          error: null,
        },
      },
    ]);

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => mock.client,
    }));

    const { validateLinkCode } = await import('../src/actions/admin-actions');

    const result = await validateLinkCode('NVP1DJ', 'telegram', 'chat-1');

    expect(result).toEqual({
      status: 'already_linked_to_other_profile',
      currentProfileId: 'profile-a',
      currentProfileName: 'Conta A',
      codeProfileId: 'profile-b',
    });
    mock.assertAllStepsUsed();
  });

  it('validateLinkCode retorna db_error quando update do profile falha', async () => {
    const mock = createSupabaseMock([
      {
        table: 'bot_link_codes',
        terminal: 'single',
        result: {
          data: { id: 'code-1', profile_id: 'profile-a', profiles: { full_name: 'Conta A' } },
          error: null,
        },
      },
      {
        table: 'profiles',
        terminal: 'maybeSingle',
        result: {
          data: null,
          error: null,
        },
      },
      {
        table: 'profiles',
        terminal: 'eq',
        result: {
          error: { message: 'update failed' },
        },
      },
    ]);

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => mock.client,
    }));

    const { validateLinkCode } = await import('../src/actions/admin-actions');

    const result = await validateLinkCode('NVP1DJ', 'telegram', 'chat-1');

    expect(result).toEqual({
      status: 'db_error',
      reason: 'update_profile_channel_failed',
    });
    mock.assertAllStepsUsed();
  });

  it('syncSessionProfileFromChannelBinding desassocia sessão sem vínculo de canal', async () => {
    const mock = createSupabaseMock([
      {
        table: 'profiles',
        terminal: 'maybeSingle',
        result: {
          data: null,
          error: null,
        },
      },
      {
        table: 'bot_sessions',
        terminal: 'eq',
        result: {
          error: null,
        },
      },
      {
        table: 'bot_messages',
        terminal: 'eq',
        result: {
          error: null,
        },
      },
    ]);

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => mock.client,
    }));

    const { syncSessionProfileFromChannelBinding } = await import('../src/session/session-manager');

    const result = await syncSessionProfileFromChannelBinding({
      id: 'session-1',
      profile_id: 'profile-a',
      channel: 'telegram',
      channel_user_id: 'chat-1',
      context: { pendingAction: 'marcar_pagamento' },
      profile: {
        id: 'profile-a',
        name: 'Conta A',
        role: 'admin',
        tenant_id: 'tenant-a',
      },
    });

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('no_channel_binding');
    expect(result.oldProfileId).toBe('profile-a');
    expect(result.newProfileId).toBeNull();
    expect(result.session.profile_id).toBeNull();
    expect(result.session.profile).toBeNull();
    expect(result.session.context).toEqual({});

    const sessionUpdate = mock.calls.find(c => c.table === 'bot_sessions' && c.method === 'update');
    expect(sessionUpdate?.args[0]).toEqual(expect.objectContaining({ profile_id: null, context: {} }));
    mock.assertAllStepsUsed();
  });

  it('syncSessionProfileFromChannelBinding rebinda sessão e limpa histórico/contexto', async () => {
    const mock = createSupabaseMock([
      {
        table: 'profiles',
        terminal: 'maybeSingle',
        result: {
          data: {
            id: 'profile-b',
            full_name: 'Conta B',
            role: 'admin',
            tenant_id: 'tenant-b',
          },
          error: null,
        },
      },
      {
        table: 'bot_sessions',
        terminal: 'eq',
        result: {
          error: null,
        },
      },
      {
        table: 'bot_messages',
        terminal: 'eq',
        result: {
          error: null,
        },
      },
    ]);

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => mock.client,
    }));

    const { syncSessionProfileFromChannelBinding } = await import('../src/session/session-manager');

    const result = await syncSessionProfileFromChannelBinding({
      id: 'session-1',
      profile_id: 'profile-a',
      channel: 'telegram',
      channel_user_id: 'chat-1',
      context: { pendingAction: 'criar_contrato' },
      profile: {
        id: 'profile-a',
        name: 'Conta A',
        role: 'admin',
        tenant_id: 'tenant-a',
      },
    });

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('rebound');
    expect(result.oldProfileId).toBe('profile-a');
    expect(result.newProfileId).toBe('profile-b');
    expect(result.session.profile_id).toBe('profile-b');
    expect(result.session.profile?.name).toBe('Conta B');
    expect(result.session.context).toEqual({});

    const messageDelete = mock.calls.find(c => c.table === 'bot_messages' && c.method === 'delete');
    expect(messageDelete).toBeTruthy();
    mock.assertAllStepsUsed();
  });
});
