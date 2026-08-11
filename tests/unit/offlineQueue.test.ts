/**
 * Fila local da baixa offline. O teste roda sem browser e fornece somente o
 * localStorage necessário; se persistir falhar, a UI não pode confirmar que
 * recebeu dinheiro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
});

const {
  OFFLINE_QUEUE_STORAGE_KEY,
  enqueueOfflinePayment,
  listOfflineIntents,
  markOfflineIntentApplied,
  markOfflineIntentPending,
  markOfflineIntentRejected,
  removeOfflineIntent,
} = await import('@/services/offlineQueue');

const input = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-a',
  installmentId: '11111111-1111-4111-8111-111111111111',
  investmentId: 123,
  companyId: 'company-a',
  installmentNumber: 2,
  debtorName: 'Ana Silva',
  contractName: 'Capital de giro',
  amount: 100,
  paidAt: '2026-08-11T12:00:00-03:00',
  ...overrides,
});

describe('offlineQueue', () => {
  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enfileirar gera UUID e persiste todos os dados da intenção', () => {
    const intent = enqueueOfflinePayment(input());

    expect(intent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(intent).toMatchObject({
      tenantId: 'tenant-a',
      installmentId: '11111111-1111-4111-8111-111111111111',
      investmentId: 123,
      companyId: 'company-a',
      installmentNumber: 2,
      debtorName: 'Ana Silva',
      contractName: 'Capital de giro',
      amount: 100,
      paidAt: '2026-08-11T12:00:00-03:00',
      createdAt: '2026-08-11T15:00:00.000Z',
      status: 'pending',
      errorMessage: null,
    });
    expect(listOfflineIntents()).toEqual([intent]);
    expect(store.get(OFFLINE_QUEUE_STORAGE_KEY)).toContain('"version":1');
  });

  it('listar devolve as intenções na ordem de criação', () => {
    const primeira = enqueueOfflinePayment(input({ installmentNumber: 1 }));
    vi.advanceTimersByTime(1000);
    const segunda = enqueueOfflinePayment(input({ installmentNumber: 2 }));

    expect(listOfflineIntents().map((intent) => intent.id)).toEqual([primeira.id, segunda.id]);
  });

  it('marcar como aplicada remove da fila', () => {
    const intent = enqueueOfflinePayment(input());
    markOfflineIntentApplied(intent.id);
    expect(listOfflineIntents()).toEqual([]);
  });

  it('marcar como rejeitada mantém a intenção e o motivo', () => {
    const intent = enqueueOfflinePayment(input());
    markOfflineIntentRejected(intent.id, 'Esta parcela já está quitada.');

    expect(listOfflineIntents()).toEqual([
      expect.objectContaining({
        id: intent.id,
        status: 'rejected',
        errorMessage: 'Esta parcela já está quitada.',
      }),
    ]);

    markOfflineIntentPending(intent.id);
    expect(listOfflineIntents()[0]).toMatchObject({ status: 'pending', errorMessage: null });
  });

  it('dois recebimentos iguais geram duas intenções distintas', () => {
    const primeira = enqueueOfflinePayment(input());
    const segunda = enqueueOfflinePayment(input());

    expect(primeira.id).not.toBe(segunda.id);
    expect(listOfflineIntents()).toHaveLength(2);
  });

  it('filtra por tenant sem expor a fila de outra sessão', () => {
    const a = enqueueOfflinePayment(input());
    enqueueOfflinePayment(input({ tenantId: 'tenant-b' }));
    expect(listOfflineIntents('tenant-a').map((intent) => intent.id)).toEqual([a.id]);
  });

  it('descartar remove somente a intenção escolhida', () => {
    const primeira = enqueueOfflinePayment(input({ installmentNumber: 1 }));
    const segunda = enqueueOfflinePayment(input({ installmentNumber: 2 }));
    removeOfflineIntent(primeira.id);
    expect(listOfflineIntents().map((intent) => intent.id)).toEqual([segunda.id]);
  });

  it('não sobrescreve silenciosamente uma fila corrompida', () => {
    store.set(OFFLINE_QUEUE_STORAGE_KEY, '{json quebrado');
    expect(() => enqueueOfflinePayment(input())).toThrow(/fila de baixas está corrompida/i);
    expect(store.get(OFFLINE_QUEUE_STORAGE_KEY)).toBe('{json quebrado');
  });
});
