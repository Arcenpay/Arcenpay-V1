/**
 * Per-API-key rate limiting.
 *
 * WHY THIS IS NOT AN ARCJET RULE
 * ------------------------------
 * It used to be `aj.withRule(fixedWindow({...}))`. Arcjet's `withRule()` CLONES
 * the parent client's rules, and the parent was `[shield(LIVE), detectBot(LIVE)]`.
 * The result was that a caller who had *already proven* they hold a valid,
 * DB-registered API key was re-subjected to bot detection. `curl`, Postman,
 * Insomnia and every server-to-server SDK present a non-browser User-Agent, so
 * they were classified as bots and rejected with a misleading
 * "Rate limit exceeded" (429) that never reached the documented quota.
 *
 * Two rules follow:
 *   1. A request that has presented a valid API key must NEVER be bot-blocked.
 *      Bot detection belongs on ANONYMOUS traffic only (see middleware/arcjet-global.ts).
 *   2. Counting requests per key is bookkeeping we can do correctly ourselves,
 *      without a third-party round-trip on every authenticated call and without
 *      shipping key identifiers to an external service.
 *
 * This is a fixed-window counter keyed by `ArcenApiKey.id`. `consume()` is
 * synchronous, and Node runs JavaScript on a single thread, so there is no
 * read-modify-write race between the check and the increment.
 */

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the current window resets. */
  resetAt: number;
  /** Whole seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Ceiling: 5000 requests / 60s per key (~83 req/s).
 *
 * Deliberately generous — it exists to stop runaway loops and hostile bursts,
 * not to shape normal integration traffic (SDKs, agents, dashboards, docs
 * playground). Nudging this value changes behaviour for every integration, so
 * prefer raising it over adding another exemption.
 */
export const API_KEY_RATE_LIMIT = {
  limit: 5000,
  windowMs: 60_000,
} as const;

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /**
     * Upper bound on tracked keys. The map is swept before this is enforced, so
     * it is only reached under genuine concurrent load. Bounding it prevents a
     * flood of distinct keys from growing memory without limit, which is the
     * classic unbounded-Map failure mode.
     */
    private readonly maxTrackedKeys = 20_000,
  ) {
    this.sweeper = setInterval(
      () => this.sweep(),
      Math.max(this.windowMs, 60_000),
    );
    // Never hold the process open just for cleanup.
    (this.sweeper as unknown as { unref?: () => void })?.unref?.();
  }

  /** Records one request against `key` and reports whether it is allowed. */
  consume(key: string, now: number = Date.now()): RateLimitDecision {
    const existing = this.windows.get(key);

    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      this.enforceCapacity(now);
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - 1,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - existing.count,
      resetAt: existing.resetAt,
      retryAfterSeconds: 0,
    };
  }

  /** Drops every window that has already elapsed. Returns how many were removed. */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private enforceCapacity(now: number): void {
    if (this.windows.size <= this.maxTrackedKeys) return;
    this.sweep(now);
    if (this.windows.size <= this.maxTrackedKeys) return;

    // Still full: evict the window closest to expiry. Bounded memory beats
    // unbounded growth; a caller would have to hold thousands of valid keys to
    // reset its own counter this way.
    let oldestKey: string | null = null;
    let oldestResetAt = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.windows) {
      if (window.resetAt < oldestResetAt) {
        oldestResetAt = window.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) this.windows.delete(oldestKey);
  }

  get trackedKeys(): number {
    return this.windows.size;
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }
}

/** Process-wide limiter used by `requireApiKey`. */
export const apiKeyRateLimiter = new FixedWindowRateLimiter(
  API_KEY_RATE_LIMIT.limit,
  API_KEY_RATE_LIMIT.windowMs,
);
