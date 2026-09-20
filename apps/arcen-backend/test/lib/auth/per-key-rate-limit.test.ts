import { describe, expect, it } from "vitest";
import {
  FixedWindowRateLimiter,
  API_KEY_RATE_LIMIT,
} from "../../../src/lib/auth/per-key-rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the limit and blocks the one after", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    const t = 1_000_000;

    expect(limiter.consume("key-a", t).allowed).toBe(true);
    expect(limiter.consume("key-a", t).allowed).toBe(true);
    const third = limiter.consume("key-a", t);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = limiter.consume("key-a", t);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBe(60);

    limiter.stop();
  });

  it("counts each key independently (per-key isolation)", () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    const t = 1_000_000;

    expect(limiter.consume("key-a", t).allowed).toBe(true);
    expect(limiter.consume("key-a", t).allowed).toBe(true);
    expect(limiter.consume("key-a", t).allowed).toBe(false);

    // A different key must be unaffected by key-a being exhausted. This is the
    // property the previous Arcjet-based implementation failed to provide for
    // non-browser clients.
    expect(limiter.consume("key-b", t).allowed).toBe(true);
    expect(limiter.consume("key-b", t).allowed).toBe(true);
    expect(limiter.consume("key-b", t).allowed).toBe(false);

    limiter.stop();
  });

  it("resets once the window elapses", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);
    const t = 5_000;

    expect(limiter.consume("key-a", t).allowed).toBe(true);
    expect(limiter.consume("key-a", t).allowed).toBe(false);

    expect(limiter.consume("key-a", t + 1_001).allowed).toBe(true);

    limiter.stop();
  });

  it("reports a decreasing remaining count and the window reset time", () => {
    const limiter = new FixedWindowRateLimiter(5, 30_000);
    const t = 10_000;

    const first = limiter.consume("key-a", t);
    expect(first.remaining).toBe(4);
    expect(first.resetAt).toBe(t + 30_000);
    expect(first.retryAfterSeconds).toBe(0);

    const second = limiter.consume("key-a", t);
    expect(second.remaining).toBe(3);
    expect(second.resetAt).toBe(first.resetAt);

    limiter.stop();
  });

  it("sweeps expired windows so memory does not grow without bound", () => {
    const limiter = new FixedWindowRateLimiter(10, 1_000);
    const t = 100_000;

    for (let i = 0; i < 50; i += 1) limiter.consume(`key-${i}`, t);
    expect(limiter.trackedKeys).toBe(50);

    const removed = limiter.sweep(t + 1_001);
    expect(removed).toBe(50);
    expect(limiter.trackedKeys).toBe(0);

    limiter.stop();
  });

  it("stays bounded when many distinct keys arrive inside one window", () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000, 100);
    const t = 500_000;

    for (let i = 0; i < 500; i += 1) limiter.consume(`key-${i}`, t);

    expect(limiter.trackedKeys).toBeLessThanOrEqual(100);

    limiter.stop();
  });

  it("exposes the documented production ceiling", () => {
    // Guards against an accidental change that would silently throttle every
    // customer integration.
    expect(API_KEY_RATE_LIMIT.limit).toBe(5000);
    expect(API_KEY_RATE_LIMIT.windowMs).toBe(60_000);
  });
});
