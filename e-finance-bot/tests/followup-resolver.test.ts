import { describe, expect, it } from 'vitest';
import { resolveFollowup } from '../src/assistant/followup-resolver';

describe('followup-resolver', () => {
  it('resolve "o outro" usando candidatos recentes', () => {
    const plan = resolveFollowup('o outro', {
      lastAction: 'query_debtor_balance',
      lastEntity: { type: 'debtor', id: 'debtor-1', label: 'Icaro' },
      lastDebtorCandidates: [
        { id: 'debtor-1', label: 'Icaro', cpfMasked: '***.***.***-25' },
        { id: 'debtor-2', label: 'Icaro Soares', cpfMasked: '***.***.***-05' },
      ],
    });

    expect(plan).toEqual(expect.objectContaining({
      capability: 'query_debtor_balance',
      source: 'followup',
      args: expect.objectContaining({
        debtor_profile_id: 'debtor-2',
        debtor_name: 'Icaro Soares',
      }),
    }));
  });

  it('resolve continuação temporal para cobrança', () => {
    const plan = resolveFollowup('e amanhã?', {
      lastAction: 'query_collection_window',
    });

    expect(plan).toEqual(expect.objectContaining({
      capability: 'query_collection_window',
      source: 'followup',
      args: expect.objectContaining({
        time_window: expect.objectContaining({
          windowStart: 'tomorrow',
          amount: 1,
        }),
      }),
    }));
  });
});
