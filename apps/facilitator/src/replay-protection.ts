// ============================================================
//  MEAP Facilitator — x402 Replay Protection
//
//  Prevents replaying of x402 payment headers within a
//  configurable time window by tracking payment IDs in a
//  memory-efficient TTL'd Map.
//
//  Payment ID: SHA-256 hash of the raw x-payment header value,
//  which encodes the signed payment proof (signer, amount,
//  sessionId, nonce, timestamp). Identical headers = replay.
//
//  PRD §11.2 — Replay protection
// ============================================================

import { createHash } from "crypto";

export interface ReplayProtectionStats {
  trackedPayments: number;
  windowMs: number;
  replaysRejectedTotal: number;
}

export class X402ReplayProtection {
  // paymentId → expiresAt (unix ms)
  private readonly seen = new Map<string, number>();
  private replaysRejected = 0;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    /** How long to remember a payment ID (default: 10 minutes). */
    private readonly windowMs: number = 10 * 60 * 1000,
  ) {
    // Purge expired entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.purgeExpired(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Derives a stable payment ID from the raw x-payment header value.
   * Two requests with identical headers → same ID.
   */
  static paymentIdFromHeader(headerValue: string): string {
    return createHash("sha256").update(headerValue).digest("hex");
  }

  /**
   * Checks whether this payment ID has already been seen within the window.
   *
   * - If it is a replay → increments counter, returns true.
   * - If it is fresh → records it, returns false.
   */
  checkAndRecord(paymentId: string): boolean {
    const now = Date.now();
    const exp = this.seen.get(paymentId);

    if (exp !== undefined && now < exp) {
      this.replaysRejected++;
      return true; // replay
    }

    this.seen.set(paymentId, now + this.windowMs);
    return false; // fresh
  }

  /**
   * Returns current statistics for health-check / Prometheus export.
   */
  getStats(): ReplayProtectionStats {
    return {
      trackedPayments: this.seen.size,
      windowMs: this.windowMs,
      replaysRejectedTotal: this.replaysRejected,
    };
  }

  /**
   * Stops the cleanup timer. Call on graceful shutdown.
   */
  stop(): void {
    clearInterval(this.cleanupTimer);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, exp] of this.seen) {
      if (now >= exp) this.seen.delete(id);
    }
  }
}
