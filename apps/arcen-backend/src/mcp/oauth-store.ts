import { getRedis } from "../lib/redis.js";

/**
 * Ephemeral store for short-lived OAuth artifacts (authorization codes, refresh
 * tokens).
 *
 * Uses the shared Redis client when configured and falls back to an in-process
 * Map otherwise — the same degradation model as every other cache in the
 * backend. These values are single-use and short-lived: losing them (Redis
 * outage, process restart) forces a re-authorization, never data loss.
 */
interface Entry {
  value: string;
  expiresAt: number;
}

const memory = new Map<string, Entry>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

/** Tracks size for tests/diagnostics. */
export function ephemeralSize(): number {
  return memory.size;
}

export async function putEphemeral(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, value, "EX", ttlSeconds);
      return;
    } catch {
      // fall through to memory
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Atomically consumes a single-use value: returns it once, then removes it. */
export async function takeEphemeral(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.getdel(key);
      if (value !== null) return value;
    } catch {
      // fall through to memory
    }
  }
  const value = memoryGet(key);
  if (value !== null) memory.delete(key);
  return value;
}

export async function dropEphemeral(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // ignore
    }
  }
  memory.delete(key);
}
