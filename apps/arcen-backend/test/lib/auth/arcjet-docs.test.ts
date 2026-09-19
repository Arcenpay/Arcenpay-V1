import { describe, expect, it, vi } from "vitest";

// This test uses the REAL arcjet module (no mock) to verify the docs-origin
// exemption logic. The module imports @arcjet/node which may touch env — we
// stub ARCJET_KEY so it never initializes a live client demandingly.
vi.stubEnv("ARCJET_KEY", "ajkey_placeholder");

import {
  isDocsApiOrigin,
  shouldBypassGlobalProtection,
} from "../../../src/lib/auth/arcjet.js";

function req(opts: { origin?: string; referer?: string; auth?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin) headers["origin"] = opts.origin;
  if (opts.referer) headers["referer"] = opts.referer;
  if (opts.auth) headers["authorization"] = opts.auth;
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

  it("bypasses global protection for docs-origin AND any sk_/rk_ request", () => {
    // Docs playground
    expect(shouldBypassGlobalProtection(req({ origin: "https://docs.arcenpay.com" }))).toBe(true);
    // Secret/restricted key (any origin)
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer sk_live_xxxxxxxxx" })),
    ).toBe(true);
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer rk_test_xxxxxxxxx" })),
    ).toBe(true);
    // Anonymous / publishable / embed token → NO bypass (still fully protected)
    expect(shouldBypassGlobalProtection(req())).toBe(false);
    expect(
      shouldBypassGlobalProtection(req({ auth: "Bearer pk_live_xxxxxxxxx" })),
    ).toBe(false);
  });
});
