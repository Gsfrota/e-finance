// services/appLock.ts
//
// Bloqueio local do app por PIN — conveniência para o cobrador em campo: faz o
// login completo UMA vez e depois destrava com um PIN curto, inclusive offline.
//
// PRINCÍPIO DE SEGURANÇA: o PIN NÃO é a autenticação. A sessão real é a do
// Supabase (persistida e protegida por RLS). O PIN é só uma trava sobre uma
// sessão já válida — por isso um bug aqui nunca expõe dados de outro tenant,
// e sempre há a saída "entrar com senha" (logout → login) como escape.
//
// O hash do PIN é derivado por PBKDF2 e guardado com salt; o PIN em claro nunca
// é persistido. O contador de tentativas vive no storage (sobrevive a reload),
// senão recarregar a página zeraria o limite e anularia a proteção.

export interface LockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PIN_KEY = 'ef_app_lock_pin_v1';
const ATTEMPTS_KEY = 'ef_app_lock_attempts';
const PBKDF2_ITERATIONS = 100_000;

export const MAX_PIN_ATTEMPTS = 5;

interface PinRecord {
  salt: string; // hex
  hash: string; // hex
  iter: number;
  len: number; // tamanho do PIN, para o teclado saber quantos dígitos pedir
}

function defaultStorage(): LockStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* modo privado / bloqueado */
  }
  return null;
}

function subtle(): SubtleCrypto | null {
  const c = (globalThis as any).crypto;
  return c && c.subtle ? (c.subtle as SubtleCrypto) : null;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// Comparação de tempo constante sobre os hashes hex (ambos do mesmo tamanho).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PIN numérico de 4 a 6 dígitos — "senha simples" pensada para o campo. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function isPinEnabled(storage: LockStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  return !!storage.getItem(PIN_KEY);
}

/** Tamanho do PIN configurado (para o teclado), ou null se não houver. */
export function getPinLength(storage: LockStorage | null = defaultStorage()): number | null {
  if (!storage) return null;
  const raw = storage.getItem(PIN_KEY);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as PinRecord;
    return typeof rec.len === 'number' ? rec.len : null;
  } catch {
    return null;
  }
}

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const s = subtle();
  if (!s) throw new Error('Cripto indisponível neste contexto (precisa de HTTPS).');
  const key = await s.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

export async function setPin(pin: string, storage: LockStorage | null = defaultStorage()): Promise<void> {
  if (!isValidPinFormat(pin)) throw new Error('O PIN deve ter de 4 a 6 dígitos.');
  if (!storage) throw new Error('Armazenamento indisponível.');
  const salt = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  const rec: PinRecord = { salt: toHex(salt), hash, iter: PBKDF2_ITERATIONS, len: pin.length };
  storage.setItem(PIN_KEY, JSON.stringify(rec));
  resetAttempts(storage);
}

export async function verifyPin(pin: string, storage: LockStorage | null = defaultStorage()): Promise<boolean> {
  if (!storage) return false;
  const raw = storage.getItem(PIN_KEY);
  if (!raw) return false;
  try {
    const rec = JSON.parse(raw) as PinRecord;
    const hash = await derive(pin, fromHex(rec.salt), rec.iter);
    return timingSafeEqual(hash, rec.hash);
  } catch {
    return false;
  }
}

export function disablePin(storage: LockStorage | null = defaultStorage()): void {
  if (!storage) return;
  storage.removeItem(PIN_KEY);
  resetAttempts(storage);
}

export function getFailedAttempts(storage: LockStorage | null = defaultStorage()): number {
  if (!storage) return 0;
  const n = Number(storage.getItem(ATTEMPTS_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Registra uma tentativa errada e devolve o total acumulado. */
export function recordFailedAttempt(storage: LockStorage | null = defaultStorage()): number {
  if (!storage) return 0;
  const next = getFailedAttempts(storage) + 1;
  storage.setItem(ATTEMPTS_KEY, String(next));
  return next;
}

export function resetAttempts(storage: LockStorage | null = defaultStorage()): void {
  if (!storage) return;
  storage.removeItem(ATTEMPTS_KEY);
}

/** Estourou o limite → o gate deve forçar login completo (logout). */
export function isPinLockedOut(storage: LockStorage | null = defaultStorage()): boolean {
  return getFailedAttempts(storage) >= MAX_PIN_ATTEMPTS;
}
