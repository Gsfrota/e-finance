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

  // BUG-2: followup não deve herdar lastAction quando texto indica intent contrário
  it('não redireciona "pra receber" como cobrança quando lastAction=collection (BUG-2)', () => {
    const plan = resolveFollowup('quanto tenho pra receber amanhã?', {
      lastAction: 'query_collection_window',
    });

    // Deve retornar null para o intent-router classificar como recebíveis
    expect(plan).toBeNull();
  });

  it('não redireciona "cobrar" como recebíveis quando lastAction=receivables (BUG-2)', () => {
    const plan = resolveFollowup('quem devo cobrar amanhã?', {
      lastAction: 'query_receivables_window',
    });

    expect(plan).toBeNull();
  });

  it('mantém followup temporal simples sem sinal contrário (BUG-2 regressão)', () => {
    const plan = resolveFollowup('e amanhã?', {
      lastAction: 'query_collection_window',
    });

    expect(plan).not.toBeNull();
    expect(plan?.capability).toBe('query_collection_window');
  });

  // GAP-3.2: "o outro" sem focusedDebtorId deve selecionar o segundo candidato
  it('GAP-3.2: "o outro" sem focused seleciona o segundo candidato', () => {
    const plan = resolveFollowup('o outro', {
      lastAction: 'query_debtor_balance',
      lastDebtorCandidates: [
        { id: 'debtor-1', label: 'João', cpfMasked: '***.***.***-01' },
        { id: 'debtor-2', label: 'Maria', cpfMasked: '***.***.***-02' },
      ],
      // sem lastEntity nem focusedEntity
    });

    expect(plan).not.toBeNull();
    expect(plan?.args?.debtor_profile_id).toBe('debtor-2');
    expect(plan?.args?.debtor_name).toBe('Maria');
  });

  // GAP-3.3: múltiplos candidatos com mesmo sufixo CPF deve retornar null (forçar clarificação)
  it('GAP-3.3: CPF suffix ambíguo com múltiplos matches retorna null', () => {
    const plan = resolveFollowup('25', {
      lastAction: 'query_debtor_balance',
      lastDebtorCandidates: [
        { id: 'debtor-1', label: 'João', cpfMasked: '***.***.***-25' },
        { id: 'debtor-2', label: 'Maria', cpfMasked: '***.***.***-25' },
      ],
    });

    expect(plan).toBeNull();
  });

  // GAP-3.3 regressão: CPF suffix único ainda funciona
  it('GAP-3.3: CPF suffix único ainda resolve corretamente', () => {
    const plan = resolveFollowup('25', {
      lastAction: 'query_debtor_balance',
      lastDebtorCandidates: [
        { id: 'debtor-1', label: 'João', cpfMasked: '***.***.***-25' },
        { id: 'debtor-2', label: 'Maria', cpfMasked: '***.***.***-05' },
      ],
    });

    expect(plan).not.toBeNull();
    expect(plan?.args?.debtor_profile_id).toBe('debtor-1');
  });
});
