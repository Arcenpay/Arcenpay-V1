import { beforeAll, describe, expect, it } from "vitest";
import { consumeRateLimit } from "../../../src/lib/auth/rate-limit.js";

// Force the in-memory fallback path so the test is deterministic and offline.
beforeAll(() => {
  delete process.env.REDIS_URL;
});

describe("consumeRateLimit (in-memory fallback)", () => {
  it("allows up to the limit then blocks with a retry hint", async () => {
    const config = { limit: 3, windowMs: 60_000 };
    const key = `rl-test-${Math.random()}`;

    expect((await consumeRateLimit(config, key)).allowed).toBe(true);
    expect((await consumeRateLimit(config, key)).allowed).toBe(true);
    expect((await consumeRateLimit(config, key)).allowed).toBe(true);

    const blocked = await consumeRateLimit(config, key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps keys isolated", async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const a = `rl-iso-a-${Math.random()}`;
    const b = `rl-iso-b-${Math.random()}`;

    expect((await consumeRateLimit(config, a)).allowed).toBe(true);
    expect((await consumeRateLimit(config, a)).allowed).toBe(false);
    // A different key is unaffected.
    expect((await consumeRateLimit(config, b)).allowed).toBe(true);
  });

  it("reports the ceiling in the decision", async () => {
    const decision = await consumeRateLimit(
      { limit: 7, windowMs: 1_000 },
      `rl-limit-${Math.random()}`,
    );
    expect(decision.limit).toBe(7);
    expect(decision.remaining).toBe(6);
  });
});
