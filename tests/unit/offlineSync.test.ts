import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
});

const { enqueueOfflinePayment, listOfflineIntents } = await import('@/services/offlineQueue');
const { isTransientOfflineSyncError, syncPendingOfflineIntents } = await import('@/hooks/useOfflineSync');

const enqueue = (number: number) => enqueueOfflinePayment({
  tenantId: 'tenant-a',
  installmentId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  investmentId: number,
  companyId: 'company-a',
  installmentNumber: number,
  debtorName: `Cliente ${number}`,
  contractName: `Contrato ${number}`,
  amount: number * 10,
  paidAt: '2026-08-11T12:00:00-03:00',
});

describe('syncPendingOfflineIntents', () => {
  beforeEach(() => store.clear());

  it('envia em série e remove as aplicadas', async () => {
    enqueue(1); enqueue(2); enqueue(3);
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const result = await syncPendingOfflineIntents('tenant-a', async (intent) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(intent.installmentNumber);
      await Promise.resolve();
      active -= 1;
      return { status: 'applied', duplicada: false };
    });

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(result).toEqual({ applied: 3, rejected: 0, remaining: 0, interrupted: false });
    expect(listOfflineIntents('tenant-a')).toEqual([]);
  });

  it('preserva rejeitada com motivo e continua o lote', async () => {
    enqueue(1); enqueue(2);
    const result = await syncPendingOfflineIntents('tenant-a', async (intent) =>
      intent.installmentNumber === 1
        ? { status: 'rejected', duplicada: false, erro: 'Parcela já quitada.' }
        : { status: 'applied', duplicada: false }
    );

    expect(result).toEqual({ applied: 1, rejected: 1, remaining: 0, interrupted: false });
    expect(listOfflineIntents('tenant-a')).toEqual([
      expect.objectContaining({
        installmentNumber: 1,
        status: 'rejected',
        errorMessage: 'Esta parcela já está quitada. Atualize a lista e tente novamente.',
      }),
    ]);
  });

  it('erro transitório interrompe sem condenar nem reordenar intenções', async () => {
    enqueue(1); enqueue(2);
    const submitter = vi.fn(async () => {
      throw { code: '40001', message: 'serialization failure' };
    });

    const result = await syncPendingOfflineIntents('tenant-a', submitter);

    expect(submitter).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ applied: 0, rejected: 0, remaining: 2, interrupted: true });
    expect(listOfflineIntents('tenant-a').every((intent) => intent.status === 'pending')).toBe(true);
  });

  it('erro definitivo vira pendência rejeitada em português', async () => {
    enqueue(1);
    const result = await syncPendingOfflineIntents('tenant-a', async () => {
      throw { code: '42501', message: 'Parcela não pertence ao seu tenant.' };
    });

    expect(result.rejected).toBe(1);
    expect(listOfflineIntents('tenant-a')[0]).toMatchObject({
      status: 'rejected',
      errorMessage: 'Parcela não pertence ao seu tenant.',
    });
  });

  it('classifica SQLSTATEs e falhas de rede como retry técnico', () => {
    expect(isTransientOfflineSyncError({ code: '40P01' })).toBe(true);
    expect(isTransientOfflineSyncError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientOfflineSyncError({ code: '42501', message: 'negado' })).toBe(false);
  });
});
