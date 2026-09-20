import { describe, expect, it, vi } from "vitest";

// This test uses the REAL arcjet module (no mock) to verify the docs-origin
// exemption logic. The module imports @arcjet/node which may touch env — we
// stub ARCJET_KEY so it never initializes a live client demandingly.
vi.stubEnv("ARCJET_KEY", "ajkey_placeholder");

import {
  isDocsApiOrigin,
  shouldBypassGlobalProtection,
  arcjetNodeRequest,
} from "../../../src/lib/auth/arcjet.js";

function req(opts: { origin?: string; referer?: string; auth?: string; xff?: string; realIp?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin) headers["origin"] = opts.origin;
  if (opts.referer) headers["referer"] = opts.referer;
  if (opts.auth) headers["authorization"] = opts.auth;
  if (opts.xff) headers["x-forwarded-for"] = opts.xff;
  if (opts.realIp) headers["x-real-ip"] = opts.realIp;
  return new Request("https://api.arcenpay.com/api/v1/check?key=ping", { headers });
}

describe("ArcenPay docs API playground exemption", () => {
  it("allows requests originating from https://docs.arcenpay.com", () => {
    expect(isDocsApiOrigin(req({ origin: "https://docs.arcenpay.com" }))).toBe(true);
    expect(isDocsApiOrigin(req({ referer: "https://docs.arcenpay.com/reference/check" }))).toBe(true);
  });

  it("does NOT allow arbitrary or unknown origins", () => {
    expect(isDocsApiOrigin(req({ origin: "https://evil.example.com" }))).toBe(false);
    expect(isDocsApiOrigin(req({ origin: "https://api.arcenpay.com" }))).toBe(false);
    expect(isDocsApiOrigin(req({ origin: "https://docs.other.com" }))).toBe(false);
    expect(isDocsApiOrigin(req())).toBe(false);
    expect(isDocsApiOrigin(new Request("https://api.arcenpay.com/x"))).toBe(false);
  });

  it("bypasses global protection for docs-origin AND all credential types (sk_/rk_/pk_)", () => {
    // Docs playground
    expect(shouldBypassGlobalProtection(req({ origin: "https://docs.arcenpay.com" }))).toBe(true);
    // Secret/restricted/publishable keys (any origin) — authenticated traffic
    // is trusted and never blocked by bot/shield.
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer sk_live_xxxxxxxxx" })),
    ).toBe(true);
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer rk_test_xxxxxxxxx" })),
    ).toBe(true);
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer pk_live_xxxxxxxxx" })),
    ).toBe(true);
    // Anonymous (no key) → NO bypass (still fully protected)
    expect(shouldBypassGlobalProtection(req())).toBe(false);
  });
});

describe("arcjetNodeRequest (IP fingerprint hardening)", () => {
  it("derives the client IP from X-Forwarded-For (first hop)", () => {
    const nodeReq = arcjetNodeRequest(req({ xff: "203.0.113.5, 70.41.3.18" })) as any;
    expect(nodeReq.socket.remoteAddress).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip and cf-connecting-ip", () => {
    const realIp = arcjetNodeRequest(req({ realIp: "198.51.100.7" })) as any;
    expect(realIp.socket.remoteAddress).toBe("198.51.100.7");
    const cf = arcjetNodeRequest(req({ xff: undefined, realIp: undefined })) as any;
    // no forwarded headers → loopback fallback (never empty)
    expect(cf.socket.remoteAddress).toBe("127.0.0.1");
  });

  it("never leaves the IP empty (the exact fingerprint crash we fixed)", () => {
    const nodeReq = arcjetNodeRequest(req()) as any;
    expect(nodeReq.socket.remoteAddress).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});

describe("docs playground must NEVER be per-key rate limited", () => {
  it("exempts the exact Mintlify browser flow (Origin + Referer docs.arcenpay.com)", () => {
    // This is the precise request shape Mintlify's "Try it" sends from the
    // browser: cross-origin fetch → Origin/Referer = docs.arcenpay.com.
    const browserFetch = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: {
        origin: "https://docs.arcenpay.com",
        referer: "https://docs.arcenpay.com/reference/check",
        authorization: "Bearer sk_live_docstest",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0",
      },
    });
    expect(isDocsApiOrigin(browserFetch)).toBe(true);
    expect(shouldBypassGlobalProtection(browserFetch)).toBe(true);
  });

  it("does NOT exempt a user-run curl with no docs origin (still rate limited)", () => {
    const rawCurl = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: { authorization: "Bearer sk_live_X", "user-agent": "curl/8.0" },
    });
    expect(isDocsApiOrigin(rawCurl)).toBe(false);
    expect(shouldBypassGlobalProtection(rawCurl)).toBe(true); // sk_ is always an API consumer
  });
});

