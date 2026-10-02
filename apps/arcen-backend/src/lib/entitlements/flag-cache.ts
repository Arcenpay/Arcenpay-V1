/**
 * Flag evaluation result cache.
 *
 * Backed by Redis so the cache is shared across every backend replica and
 * survives a restart. Previously this was an in-process Map, which meant each
 * replica had its own cold cache and re-ran the same flag queries — and a
 * restart threw the whole cache away.
 *
 * When `REDIS_URL` is not configured, falls back to the original in-process Map
 * so local development behaves exactly as before.
 */

import { getRedis } from "../redis.js";

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const PREFIX = "arcenpay:flagcache:";

// Fallback used only when Redis is not configured.
const memory = new Map<string, CacheEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (now >= entry.expiresAt) memory.delete(key);
  }
}, 60_000);

export async function getCachedFlag(key: string): Promise<unknown | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(PREFIX + key);
      if (raw !== null) return JSON.parse(raw);
    } catch (err) {
      console.error("[flag-cache] Redis read failed, treating as miss:", err);
    }
  }

  const entry = memory.get(key);
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry.value;
}

export async function setCachedFlag(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(PREFIX + key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch (err) {
      console.error("[flag-cache] Redis write failed, using memory only:", err);
    }
  }

  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Evicts every flag-cache entry whose key contains `pattern`.
 *
 * Uses SCAN rather than KEYS — KEYS blocks the whole Redis instance.
 */
export async function invalidateFlagCache(pattern: string): Promise<void> {
  for (const key of memory.keys()) {
    if (key.includes(pattern)) memory.delete(key);
  }

  const redis = getRedis();
  if (!redis) return;

  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${PREFIX}*${pattern}*`,
        "COUNT",
        200,
      );
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    console.error("[flag-cache] Redis invalidation failed:", err);
  }
}
