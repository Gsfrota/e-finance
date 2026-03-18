const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const PREFIX = 'ef_cache_';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export function getCached<T>(key: string): { data: T; stale: boolean } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    const stale = Date.now() - entry.timestamp > CACHE_TTL;
    return { data: entry.data, stale };
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // silencia erros de quota ou modo privado
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // silencia erros
  }
}
