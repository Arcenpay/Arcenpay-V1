// ============================================================
//  Dashboard — In-Process Sliding Window Rate Limiter
//
//  Simple token-bucket per key (IP, teamId, resourceId).
//  Designed for Next.js API routes running in a single process.
//  For multi-instance deployments, replace with a Redis-backed
//  implementation (e.g., Upstash Ratelimit or ioredis INCR+EXPIRE).
// ============================================================

interface WindowEntry {
  count: number;
  resetAt: number; // unix ms
}

const store = new Map<string, WindowEntry>();

// Prune entries older than their window every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  ok: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix ms when the current window resets */
  resetAt: number;
}

/**
 * Checks and increments the request count for `key` within a sliding window.
 *
 * @param key      - Unique bucket key (e.g. `nonce:${ip}`, `invite:${teamId}`)
 * @param limit    - Max requests allowed per window
 * @param windowMs - Window duration in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;

  return {
    ok: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Adds rate-limit headers to a Response-like object.
 * Call before returning from an API route.
 */
export function applyRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult,
  limit: number,
): void {
  headers.set("x-ratelimit-limit", String(limit));
  headers.set("x-ratelimit-remaining", String(result.remaining));
  headers.set(
    "x-ratelimit-reset",
    String(Math.ceil(result.resetAt / 1000)),
  );
}
