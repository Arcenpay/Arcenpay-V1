// ============================================================
//  @arcenpay/node — Nonce Store
//  Pluggable nonce deduplication for x402 anti-replay
//  PRD §7.1 — Durable replay protection
// ============================================================

/**
 * NonceStore — Interface for x402 nonce deduplication.
 *
 * Implementations must provide atomic check-and-set semantics:
 * if `markUsed` returns true, the nonce was not previously seen
 * and is now marked as used. If it returns false, the nonce is
 * a replay and must be rejected.
 */
export interface NonceStore {
  /**
   * Atomically check if nonce was used and mark it used.
   * @returns true if nonce was fresh (now marked), false if already seen (replay)
   */
  markUsed(key: string, ttlMs: number): Promise<boolean>;

  /** Check if nonce has been used. */
  has(key: string): Promise<boolean>;

  /** Stop background processes (timers etc.) */
  stop(): void;
}

// ============================================================
//  InMemoryNonceStore — Default implementation
//  Suitable for single-instance deployments or testing.
// ============================================================

export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.seen) {
        if (now >= expiresAt) {
          this.seen.delete(key);
        }
      }
    }, cleanupIntervalMs);

    // Allow GC if middleware is discarded (for tests)
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async markUsed(key: string, ttlMs: number): Promise<boolean> {
    if (this.seen.has(key)) {
      const expiresAt = this.seen.get(key)!;
      if (Date.now() < expiresAt) {
        return false; // Replay — nonce still valid
      }
      // Expired entry — treat as fresh
    }
    this.seen.set(key, Date.now() + ttlMs);
    return true; // Fresh nonce
  }

  async has(key: string): Promise<boolean> {
    if (!this.seen.has(key)) return false;
    const expiresAt = this.seen.get(key)!;
    if (Date.now() >= expiresAt) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  stop(): void {
    clearInterval(this.cleanupTimer);
  }
}

// ============================================================
//  RedisNonceStore — Production implementation
//  Uses SET NX EX for atomic deduplication across instances.
//  Requires ioredis or redis-compatible client.
// ============================================================

export interface RedisLike {
  set(
    key: string,
    value: string,
    exMode: "EX",
    exValue: number,
    nxMode: "NX",
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  quit(): Promise<string>;
}

export class RedisNonceStore implements NonceStore {
  private readonly redis: RedisLike;
  private readonly prefix: string;

  constructor(redis: RedisLike, prefix = "arcenpay:nonce:") {
    this.redis = redis;
    this.prefix = prefix;
  }

  async markUsed(key: string, ttlMs: number): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    // SET key value EX ttl NX — only sets if key does NOT exist
    const result = await this.redis.set(
      `${this.prefix}${key}`,
      "1",
      "EX",
      ttlSeconds,
      "NX",
    );
    // result is "OK" if set (fresh), null if already exists (replay)
    return result === "OK";
  }

  async has(key: string): Promise<boolean> {
    const result = await this.redis.get(`${this.prefix}${key}`);
    return result !== null;
  }

  stop(): void {
    // Redis connection lifecycle managed externally
  }
}
