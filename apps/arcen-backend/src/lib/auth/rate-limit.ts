/**
 * Distributed fixed-window rate limiting.
 *
 * WHY
 * ---
 * The in-process `Map` limiter (`per-key-rate-limit.ts`) only counts requests
 * that land on a single process. Behind more than one replica (Railway), an
 * attacker gets N × the ceiling for free by spreading requests, and every
 * restart resets the counter. This module moves the counter to the shared Redis
 * (`lib/redis.ts`) so limits aggregate across replicas and survive restarts.
 *
 * SAFETY
 * ------
 *  - Redis is a CACHE — never the source of truth. If it is unconfigured or
 *    errors, we DEGRADE to the in-memory limiter rather than fail open with no
 *    limit at all. Local dev keeps working with no `REDIS_URL`.
 *  - The Redis path is a single Lua script so `INCR` + `PEXPIRE` + `PTTL` are
 *    atomic; two concurrent requests can never both create the window or both
 *    see a stale count.
 */

import type { Context } from "hono";
import { getRedis } from "../redis.js";
import { FixedWindowRateLimiter, type RateLimitDecision } from "./per-key-rate-limit.js";
import { resolveTrustedClientIp } from "./client-ip.js";

export type { RateLimitDecision };

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

const KEY_PREFIX = "arcenpay:rl:";

// Atomic fixed-window: increments the counter, arms the TTL exactly once, and
// returns [count, ttlMs]. PEXPIRE NX would need Redis >= 7; doing it inside the
// script on `current == 1` works everywhere.
const FIXED_WINDOW_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

// Lazily-created in-memory limiters, one per (limit, window) shape, used only
// when Redis is unavailable. Bounded by the small number of distinct configs.
const memoryLimiters = new Map<string, FixedWindowRateLimiter>();

function memoryLimiter(config: RateLimitConfig): FixedWindowRateLimiter {
  const key = `${config.limit}:${config.windowMs}`;
  let limiter = memoryLimiters.get(key);
  if (!limiter) {
    limiter = new FixedWindowRateLimiter(config.limit, config.windowMs);
    memoryLimiters.set(key, limiter);
  }
  return limiter;
}

function fromMemory(config: RateLimitConfig, key: string): RateLimitDecision {
  return memoryLimiter(config).consume(key);
}

/**
 * Records one request against `key` for the given window and reports whether it
 * is allowed. Uses Redis when configured, otherwise the in-process limiter.
 */
export async function consumeRateLimit(
  config: RateLimitConfig,
  key: string,
): Promise<RateLimitDecision> {
  const redis = getRedis();
  if (!redis) return fromMemory(config, key);

  const redisKey = `${KEY_PREFIX}${key}`;
  const now = Date.now();
  try {
    const result = (await redis.eval(
      FIXED_WINDOW_SCRIPT,
      1,
      redisKey,
      String(config.windowMs),
    )) as [number | string, number | string];

    const count = Number(result[0]);
    const ttl = Number(result[1]);
    const ttlMs = ttl > 0 ? ttl : config.windowMs;
    const resetAt = now + ttlMs;
    const allowed = count <= config.limit;
    return {
      allowed,
      limit: config.limit,
      remaining: Math.max(0, config.limit - count),
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  } catch (err) {
    console.error(
      "[rate-limit] Redis unavailable, falling back to in-memory limiter:",
      err instanceof Error ? err.message : String(err),
    );
    return fromMemory(config, key);
  }
}

export interface EnforceRateLimitOptions extends RateLimitConfig {
  /** Logical bucket name (kept in the Redis key). */
  bucket: string;
  /**
   * Explicit identifier. When omitted the trusted client IP (rightmost
   * proxy-appended XFF hop) is used.
   */
  identifier?: string;
  /**
   * When true (default), a request with NO resolvable trusted client IP is
   * treated as internal/co-located traffic and is NOT limited. External traffic
   * always carries a proxy-appended XFF hop (Railway's edge), so this exempts
   * first-party server-to-server calls (facilitator, dashboard SSR) without
   * opening a bypass for internet clients. Mirrors `arcjetGlobalProtect`.
   */
  skipWhenNoClientIp?: boolean;
}

function resolveIdentifier(c: Context, explicit?: string): string | null {
  if (explicit) return explicit;
  return resolveTrustedClientIp(c.req.raw.headers);
}

function applyHeaders(c: Context, decision: RateLimitDecision): void {
  c.header("x-ratelimit-limit", String(decision.limit));
  c.header("x-ratelimit-remaining", String(decision.remaining));
  c.header("x-ratelimit-reset", String(Math.ceil(decision.resetAt / 1000)));
}

/**
 * Enforces a rate limit for `c`. Returns a 429 Response when the ceiling is
 * exceeded, or `null` when the request may proceed (headers are set either way).
 * Call at the top of a handler: `const limited = await enforceRateLimit(...); if (limited) return limited;`
 */
export async function enforceRateLimit(
  c: Context,
  options: EnforceRateLimitOptions,
): Promise<Response | null> {
  const identifier = resolveIdentifier(c, options.identifier);
  if (identifier === null) {
    // No trusted client IP → internal/co-located caller. Not an IP-limited
    // surface (see skipWhenNoClientIp).
    if (options.skipWhenNoClientIp === false) {
      // Explicitly requested limiting, but we have no key to limit on. Bucket
      // these together rather than silently dropping the limit.
      return pendingLimit(c, options, "internal");
    }
    return null;
  }

  return pendingLimit(c, options, identifier);
}

async function pendingLimit(
  c: Context,
  options: EnforceRateLimitOptions,
  identifier: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit(
    { limit: options.limit, windowMs: options.windowMs },
    `${options.bucket}:${identifier}`,
  );
  applyHeaders(c, decision);

  if (!decision.allowed) {
    c.header("retry-after", String(decision.retryAfterSeconds));
    return c.json(
      {
        ok: false,
        error: "Too many requests. Please slow down and try again shortly.",
        code: "RATE_LIMITED",
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      429 as any,
    );
  }
  return null;
}
