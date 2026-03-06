const DEFAULT_TTL_MS = 120_000;
const cache = new Map<string, number>();

function cleanup(now: number): void {
  for (const [key, expiresAt] of cache.entries()) {
    if (expiresAt <= now) cache.delete(key);
  }
}

export function isDuplicateMessage(
  channel: 'whatsapp' | 'telegram',
  messageId: string,
  ttlMs = DEFAULT_TTL_MS
): boolean {
  const now = Date.now();
  cleanup(now);

  const key = `${channel}:${messageId}`;
  const expiresAt = cache.get(key);

  if (expiresAt && expiresAt > now) {
    return true;
  }

  cache.set(key, now + ttlMs);
  return false;
}

export function resetMessageDedupeCache(): void {
  cache.clear();
}
