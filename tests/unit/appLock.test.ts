import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidPinFormat, setPin, verifyPin, isPinEnabled, getPinLength, disablePin,
  getFailedAttempts, recordFailedAttempt, resetAttempts, isPinLockedOut,
  MAX_PIN_ATTEMPTS, type LockStorage,
} from '@/services/appLock';

// Storage em memória (vitest roda em node, sem localStorage).
function memStorage(): LockStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

let s: LockStorage;
beforeEach(() => { s = memStorage(); });

describe('appLock — formato do PIN', () => {
  it('aceita 4 a 6 dígitos', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
  });
  it('rejeita curto, longo ou com não-dígitos', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
  });
});

describe('appLock — PIN hash/verify', () => {
  it('define e verifica o PIN correto', async () => {
    await setPin('4729', s);
    expect(isPinEnabled(s)).toBe(true);
    expect(getPinLength(s)).toBe(4);
    expect(await verifyPin('4729', s)).toBe(true);
  });

  it('rejeita PIN errado', async () => {
    await setPin('4729', s);
    expect(await verifyPin('0000', s)).toBe(false);
  });

  it('não persiste o PIN em claro', async () => {
    await setPin('4729', s);
    const raw = s.getItem('ef_app_lock_pin_v1')!;
    expect(raw).not.toContain('4729');
    expect(raw).toContain('salt');
    expect(raw).toContain('hash');
  });

  it('setPin recusa formato inválido', async () => {
    await expect(setPin('12', s)).rejects.toThrow();
  });

  it('disablePin remove o registro', async () => {
    await setPin('4729', s);
    disablePin(s);
    expect(isPinEnabled(s)).toBe(false);
    expect(await verifyPin('4729', s)).toBe(false);
  });

  it('salt aleatório: mesmo PIN gera hashes diferentes', async () => {
    await setPin('4729', s);
    const a = s.getItem('ef_app_lock_pin_v1')!;
    const s2 = memStorage();
    await setPin('4729', s2);
    const b = s2.getItem('ef_app_lock_pin_v1')!;
    expect(a).not.toEqual(b);
  });
});

describe('appLock — contador de tentativas', () => {
  it('conta, bloqueia no limite e reseta', () => {
    expect(getFailedAttempts(s)).toBe(0);
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) recordFailedAttempt(s);
    expect(isPinLockedOut(s)).toBe(false);
    expect(recordFailedAttempt(s)).toBe(MAX_PIN_ATTEMPTS);
    expect(isPinLockedOut(s)).toBe(true);
    resetAttempts(s);
    expect(getFailedAttempts(s)).toBe(0);
    expect(isPinLockedOut(s)).toBe(false);
  });

  it('verificar o PIN certo não é afetado por tentativas antigas (reset é responsabilidade do gate)', async () => {
    await setPin('4729', s); // setPin reseta tentativas
    expect(getFailedAttempts(s)).toBe(0);
  });
});
