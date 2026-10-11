import { beforeAll, describe, expect, it } from "vitest";
import { enforceRateLimit } from "../../../src/lib/auth/rate-limit.js";

// Force the in-memory fallback so no Redis is required.
beforeAll(() => {
  delete process.env.REDIS_URL;
});

function fakeContext(headers: Record<string, string>) {
  const resHeaders: Record<string, string> = {};
  return {
    req: { raw: { headers: new Headers(headers) } },
    header(name: string, value: string) {
      resHeaders[name] = value;
    },
    json(body: unknown, status: number) {
      return new Response(JSON.stringify(body), { status });
    },
    _resHeaders: resHeaders,
  } as any;
}

describe("enforceRateLimit (request-level)", () => {
  it("does NOT limit internal traffic with no trusted client IP", async () => {
    // No x-forwarded-for / x-real-ip / cf-connecting-ip → internal caller.
    const result = await enforceRateLimit(fakeContext({}), {
      bucket: "internal-test",
      limit: 1,
      windowMs: 60_000,
    });
    expect(result).toBeNull();
  });

  it("limits external requests per client IP and returns 429 past the ceiling", async () => {
    const opts = { bucket: `ext-${Math.random()}`, limit: 2, windowMs: 60_000 };
    const headers = { "x-forwarded-for": "203.0.113.9" };

    expect(await enforceRateLimit(fakeContext(headers), opts)).toBeNull();
    expect(await enforceRateLimit(fakeContext(headers), opts)).toBeNull();

    const third = await enforceRateLimit(fakeContext(headers), opts);
    expect(third).not.toBeNull();
    expect(third!.status).toBe(429);
    const body = (await third!.json()) as { code?: string; retryAfterSeconds?: number };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys limits per IP, so one client cannot exhaust another's window", async () => {
    const opts = { bucket: `iso-${Math.random()}`, limit: 1, windowMs: 60_000 };

    expect(
      await enforceRateLimit(fakeContext({ "x-forwarded-for": "198.51.100.1" }), opts),
    ).toBeNull();
    // Different client IP is unaffected.
    expect(
      await enforceRateLimit(fakeContext({ "x-forwarded-for": "198.51.100.2" }), opts),
    ).toBeNull();
    // First client is now exhausted.
    const again = await enforceRateLimit(
      fakeContext({ "x-forwarded-for": "198.51.100.1" }),
      opts,
    );
    expect(again?.status).toBe(429);
  });
});
