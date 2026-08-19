const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const PREFIX = 'ef_cache_';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export function getCached<T>(key: string): { data: T; stale: boolean; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    const stale = Date.now() - entry.timestamp > CACHE_TTL;
    // `fetchedAt` é o que a UI usa para dizer "atualizado há 3h" quando está
    // offline. Sem isso o operador olha um saldo de ontem achando que é de agora.
    return { data: entry.data, stale, fetchedAt: entry.timestamp };
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    // Quota estourada, modo privado ou estrutura circular. Não quebra a tela,
    // mas grita: sem esta gravação o aparelho fica sem dado para trabalhar sem
    // rede, e o silêncio aqui já escondeu exatamente essa falha uma vez.
    console.warn('[cache] não foi possível gravar', key, error);
  }
}

/**
 * Timestamp mais recente entre as entradas de um prefixo.
 *
 * A faixa de offline é global (fica no shell, não numa tela), então ela não
 * recebe o `fetchedAt` de nenhum hook — pergunta ao cache qual foi o último
 * sync de dados de carteira.
 */
export function getNewestCachedAt(prefixoLogico: string): number | null {
  try {
    let maisRecente: number | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (!chave || !chave.startsWith(PREFIX + prefixoLogico)) continue;
      const raw = localStorage.getItem(chave);
      if (!raw) continue;
      const entry: CacheEntry<unknown> = JSON.parse(raw);
      if (typeof entry.timestamp === 'number' && (maisRecente === null || entry.timestamp > maisRecente)) {
        maisRecente = entry.timestamp;
      }
    }
    return maisRecente;
  } catch {
    return null;
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // silencia erros
  }
}

export function clearCachePrefix(prefix = PREFIX): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // silencia erros
  }
}

export function clearAllCache(): void {
  clearCachePrefix(PREFIX);
}
