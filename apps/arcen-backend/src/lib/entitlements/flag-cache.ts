/**
 * Flag evaluation result cache.
 *
 * Uses an in-process LRU-style Map with TTL.
 * For multi-instance deployments replace with Redis (ioredis/Upstash).
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Prune expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
}, 60_000);

export async function getCachedFlag(key: string): Promise<unknown | null> {
  const entry = cache.get(key);
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry.value;
}

export async function setCachedFlag(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function invalidateFlagCache(pattern: string): void {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}
