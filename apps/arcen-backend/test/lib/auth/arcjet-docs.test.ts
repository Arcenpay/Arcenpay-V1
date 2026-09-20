import { describe, expect, it, vi, beforeEach } from "vitest";

// This test uses the REAL arcjet module (no mock) to verify the docs-origin
// exemption logic. The module imports @arcjet/node which may touch env — we
// stub ARCJET_KEY so it never initializes a live client demandingly.
vi.stubEnv("ARCJET_KEY", "ajkey_placeholder");
vi.stubEnv("NODE_ENV", "test");

// Mock db so the fail-closed DB verification is deterministic per test.
vi.mock("../../../src/db.js", () => ({
  db: {
    arcenApiKey: { findUnique: vi.fn() },
  },
}));

import {
  isDocsApiOrigin,
  shouldBypassGlobalProtection,
  arcjetNodeRequest,
} from "../../../src/lib/auth/arcjet.js";
import { db } from "../../../src/db.js";

const mockDb = db as any;

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
      expiresAt: null,
    });
  });

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
});

describe("shouldBypassGlobalProtection (fail-closed, DB-verified)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
      expiresAt: null,
    });
  });

  it("does NOT bypass on a forged docs Origin header", async () => {
    // SECURITY REGRESSION TEST: `Origin` is a request header, so it is fully
    // client-controlled. Trusting it let anyone reach every endpoint without
    // bot/shield protection by setting a single header. The docs playground
    // uses a real API key, so no origin-based bypass is needed.
    mockDb.arcenApiKey.findUnique.mockResolvedValue(null);
    expect(
      await shouldBypassGlobalProtection(req({ origin: "https://docs.arcenpay.com" })),
    ).toBe(false);
  });

  it("bypasses for a REAL registered key (found in DB, active)", async () => {
    expect(
      await shouldBypassGlobalProtection(req({ auth: "Bearer sk_live_realregisteredkey" })),
    ).toBe(true);
    expect(mockDb.arcenApiKey.findUnique).toHaveBeenCalled();
  });

  it("FAILS CLOSED for a FAKE/foreign key (not in DB → NO bypass)", async () => {
    mockDb.arcenApiKey.findUnique.mockResolvedValue(null);
    expect(
      await shouldBypassGlobalProtection(req({ auth: "Bearer sk_live_hackerkey123" })),
    ).toBe(false);
  });

  it("FAILS CLOSED for a REVOKED key (in DB but revoked → NO bypass)", async () => {
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: new Date(),
      expiresAt: null,
    });
    expect(
      await shouldBypassGlobalProtection(req({ auth: "Bearer rk_live_revokedkey" })),
    ).toBe(false);
  });

  it("FAILS CLOSED for an EXPIRED key", async () => {
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      await shouldBypassGlobalProtection(req({ auth: "Bearer pk_test_expiredkey" })),
    ).toBe(false);
  });

  it("does NOT bypass for anonymous requests", async () => {
    expect(await shouldBypassGlobalProtection(req())).toBe(false);
  });
});

describe("arcjetNodeRequest (IP fingerprint hardening)", () => {
  it("derives the client IP from the TRUSTED (rightmost) X-Forwarded-For hop", () => {
    // SECURITY REGRESSION TEST: the leftmost entry is attacker-supplied. A
    // caller could rotate it per request and evade every IP-based limit.
    const nodeReq = arcjetNodeRequest(
      req({ xff: "203.0.113.5, 70.41.3.18" }),
    ) as any;
    expect(nodeReq.socket.remoteAddress).toBe("70.41.3.18");
  });

  it("ignores attacker-prepended hops and uses the proxy-appended client IP", () => {
    const nodeReq = arcjetNodeRequest(
      req({ xff: "1.2.3.4, 5.6.7.8, 198.51.100.7" }),
    ) as any;
    expect(nodeReq.socket.remoteAddress).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip when no forwarded chain is present", () => {
    const realIp = arcjetNodeRequest(req({ realIp: "198.51.100.7" })) as any;
    expect(realIp.socket.remoteAddress).toBe("198.51.100.7");
  });

  it("rejects non-IP garbage in the forwarded chain", () => {
    const nodeReq = arcjetNodeRequest(req({ xff: "not-an-ip" })) as any;
    expect(nodeReq.socket.remoteAddress).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(nodeReq.socket.remoteAddress).not.toBe("not-an-ip");
  });

  it("never leaves the IP empty (the exact fingerprint crash we fixed)", () => {
    const nodeReq = arcjetNodeRequest(req()) as any;
    expect(nodeReq.socket.remoteAddress).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});

describe("docs playground is never granted a rate-limit exemption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.arcenApiKey.findUnique.mockResolvedValue(null);
  });

  it("does NOT bypass for the Mintlify browser flow without a registered key", async () => {
    // The playground sends the caller's real key, so it must not need an
    // exemption. Without a registered key it is subject to bot/shield.
    const browserFetch = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: {
        origin: "https://docs.arcenpay.com",
        referer: "https://docs.arcenpay.com/reference/check",
        authorization: "Bearer sk_live_docstest",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0",
      },
    });
    expect(await shouldBypassGlobalProtection(browserFetch)).toBe(false);
  });

  it("bypasses for a docs playground request that carries a REGISTERED key", async () => {
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
      expiresAt: null,
    });
    const browserFetch = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: {
        origin: "https://docs.arcenpay.com",
        authorization: "Bearer sk_live_realkey",
      },
    });
    expect(await shouldBypassGlobalProtection(browserFetch)).toBe(true);
  });

  it("a user-run curl with a REAL registered key DOES bypass regardless of UA", async () => {
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
      expiresAt: null,
    });
    const rawCurl = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: { authorization: "Bearer sk_live_realkey", "user-agent": "curl/8.0" },
    });
    expect(isDocsApiOrigin(rawCurl)).toBe(false);
    expect(await shouldBypassGlobalProtection(rawCurl)).toBe(true);
  });

  it("a user-run curl with a FAKE key does NOT bypass (bot/shield applies)", async () => {
    const rawCurl = new Request("https://api.arcenpay.com/api/v1/check?key=ping", {
      headers: { authorization: "Bearer sk_live_fakekey", "user-agent": "curl/8.0" },
    });
    expect(await shouldBypassGlobalProtection(rawCurl)).toBe(false);
  });
});

