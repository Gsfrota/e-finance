/**
 * services/cache.ts — o cache que sustenta a leitura offline.
 *
 * Ele já persistia em localStorage com timestamp; o que faltava era EXPOR esse
 * timestamp, para a tela poder dizer há quanto tempo o dado foi atualizado.
 * Sem isso o operador olha um saldo de ontem achando que é de agora.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A suíte roda em `environment: 'node'` de propósito — unit puro, sem browser,
// em milissegundos. O cache usa localStorage, então o teste fornece o mínimo
// necessário em vez de arrastar jsdom para os outros 54 testes.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});

const { clearAllCache, getCached, setCached } = await import('@/services/cache');

describe('cache — idade do dado', () => {
  beforeEach(() => {
    store.clear();
    clearAllCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve fetchedAt junto com os dados', () => {
    vi.useFakeTimers();
    const momento = new Date(2026, 7, 11, 8, 0, 0);
    vi.setSystemTime(momento);
    setCached('k', { valor: 1 });

    const lido = getCached<{ valor: number }>('k');
    expect(lido?.data).toEqual({ valor: 1 });
    expect(lido?.fetchedAt).toBe(momento.getTime());
  });

  it('marca stale depois do TTL de 5 minutos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11, 8, 0, 0));
    setCached('k', { valor: 1 });

    expect(getCached('k')?.stale).toBe(false);

    vi.setSystemTime(new Date(2026, 7, 11, 8, 5, 1));
    expect(getCached('k')?.stale).toBe(true);
  });

  it('fetchedAt sobrevive ao dado ficar velho — é o que a UI mostra offline', () => {
    vi.useFakeTimers();
    const ontem = new Date(2026, 7, 10, 7, 30, 0);
    vi.setSystemTime(ontem);
    setCached('carteira', { parcelas: 3 });

    vi.setSystemTime(new Date(2026, 7, 11, 9, 0, 0));
    const lido = getCached<{ parcelas: number }>('carteira');
    expect(lido?.stale).toBe(true);
    expect(lido?.data).toEqual({ parcelas: 3 });
    expect(lido?.fetchedAt).toBe(ontem.getTime());
  });

  it('devolve null quando não há nada guardado', () => {
    expect(getCached('inexistente')).toBeNull();
  });
});
