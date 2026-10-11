import { describe, expect, it } from "vitest";
import { resolveTrustedClientIp } from "../../../src/lib/auth/client-ip.js";

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("resolveTrustedClientIp", () => {
  it("uses the rightmost XFF hop (the proxy-appended one), not the spoofable leftmost", () => {
    // Attacker prepends 9.9.9.9; our proxy appends the real client 203.0.113.7.
    const ip = resolveTrustedClientIp(
      headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }),
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip when XFF has no valid hop", () => {
    expect(
      resolveTrustedClientIp(headers({ "x-real-ip": "198.51.100.4" })),
    ).toBe("198.51.100.4");
  });

  it("falls back to cf-connecting-ip", () => {
    expect(
      resolveTrustedClientIp(headers({ "cf-connecting-ip": "198.51.100.9" })),
    ).toBe("198.51.100.9");
  });

  it("rejects garbage values", () => {
    expect(
      resolveTrustedClientIp(headers({ "x-forwarded-for": "not-an-ip" })),
    ).toBeNull();
  });

  it("returns null when no headers are present", () => {
    expect(resolveTrustedClientIp(headers({}))).toBeNull();
  });
});
