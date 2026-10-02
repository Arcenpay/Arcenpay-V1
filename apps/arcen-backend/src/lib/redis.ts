import Redis from "ioredis";

/**
 * Shared Redis client for the API.
 *
 * Every cache in the backend reads through here. Rules:
 *  - Absent `REDIS_URL` is NOT an error: `getRedis()` returns null and callers
 *    fall back to their own in-process behaviour, so local dev is unchanged.
 *  - Fail fast (`maxRetriesPerRequest: 1`, `enableOfflineQueue: false`) so a
 *    Redis outage degrades to a cache miss instead of hanging a request.
 *  - Redis is a CACHE only. Nothing here may ever be the sole source of truth.
 */
let client: Redis | null = null;
let initialised = false;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (initialised) return client;
  initialised = true;

  try {
    client = new Redis(process.env.REDIS_URL!.trim(), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    });
    client.on("error", (err) => {
      console.error(
        "[redis] error:",
        err instanceof Error ? err.message : String(err),
      );
    });
    console.log("[redis] Cache client initialised");
  } catch (err) {
    console.error("[redis] Failed to initialise, caching disabled:", err);
    client = null;
  }

  return client;
}
