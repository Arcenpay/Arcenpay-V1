// ============================================================
//  Security Test Suite — Phase 6 Abuse & Hardening Tests
// ============================================================

import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from "vitest";

// ── 1. Invoice download HMAC token ────────────────────────────

vi.mock("@/lib/config", () => ({
  APP_URL: "http://localhost:3000",
  INVOICE_STORAGE_DIR: "/tmp/test-invoices",
  INVOICE_DOWNLOAD_SIGNING_SECRET: "test-signing-secret",
  INVOICE_DOWNLOAD_URL_TTL_SECONDS: 86400,
}));

describe("Invoice download token — tamper resistance", () => {
  let createInvoiceDownloadUrl: (id: string, key: string) => string;
  let verifyInvoiceDownloadToken: (input: {
    invoiceId: string;
    objectKey: string;
    expRaw: string;
    signature: string;
  }) => boolean;

  beforeAll(async () => {
    const mod = await import("./invoice-documents");
    createInvoiceDownloadUrl = mod.createInvoiceDownloadUrl;
    verifyInvoiceDownloadToken = mod.verifyInvoiceDownloadToken;
  });

  const INVOICE_ID = "inv_abc123";
  const OBJECT_KEY = "team_x/inv_abc123.pdf";

  it("valid token is accepted", () => {
    const url = new URL(createInvoiceDownloadUrl(INVOICE_ID, OBJECT_KEY));
    const sig = decodeURIComponent(url.searchParams.get("sig")!);
    const key = decodeURIComponent(url.searchParams.get("key")!);
    const exp = url.searchParams.get("exp")!;
    expect(verifyInvoiceDownloadToken({ invoiceId: INVOICE_ID, objectKey: key, expRaw: exp, signature: sig })).toBe(true);
  });

  it("tampered invoiceId is rejected", () => {
    const url = new URL(createInvoiceDownloadUrl(INVOICE_ID, OBJECT_KEY));
    const sig = decodeURIComponent(url.searchParams.get("sig")!);
    const key = decodeURIComponent(url.searchParams.get("key")!);
    const exp = url.searchParams.get("exp")!;
    expect(verifyInvoiceDownloadToken({ invoiceId: "inv_EVIL999", objectKey: key, expRaw: exp, signature: sig })).toBe(false);
  });

  it("tampered objectKey is rejected", () => {
    const url = new URL(createInvoiceDownloadUrl(INVOICE_ID, OBJECT_KEY));
    const sig = decodeURIComponent(url.searchParams.get("sig")!);
    const exp = url.searchParams.get("exp")!;
    expect(verifyInvoiceDownloadToken({ invoiceId: INVOICE_ID, objectKey: "team_evil/secrets.pdf", expRaw: exp, signature: sig })).toBe(false);
  });

  it("expired token is rejected", async () => {
    const { createHmac } = await import("crypto");
    const expiredExp = String(Math.floor(Date.now() / 1000) - 1);
    const payload = `${INVOICE_ID}.${OBJECT_KEY}.${expiredExp}`;
    const sig = createHmac("sha256", "test-signing-secret").update(payload).digest("base64url");
    expect(verifyInvoiceDownloadToken({ invoiceId: INVOICE_ID, objectKey: OBJECT_KEY, expRaw: expiredExp, signature: sig })).toBe(false);
  });

  it("forged signature (wrong secret) is rejected", async () => {
    const { createHmac } = await import("crypto");
    const url = new URL(createInvoiceDownloadUrl(INVOICE_ID, OBJECT_KEY));
    const key = decodeURIComponent(url.searchParams.get("key")!);
    const exp = url.searchParams.get("exp")!;
    const forgedSig = createHmac("sha256", "attacker-secret").update(`${INVOICE_ID}.${key}.${exp}`).digest("base64url");
    expect(verifyInvoiceDownloadToken({ invoiceId: INVOICE_ID, objectKey: key, expRaw: exp, signature: forgedSig })).toBe(false);
  });
});

// ── 2. Rate limiter ───────────────────────────────────────────

describe("Rate limiter", () => {
  let rateLimit: (key: string, limit: number, windowMs: number) => { ok: boolean; remaining: number; resetAt: number };

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import("./rate-limit");
    rateLimit = mod.rateLimit;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    for (let i = 1; i <= 5; i++) expect(rateLimit("test:key", 5, 60_000).ok).toBe(true);
  });

  it("blocks the 6th request when limit is 5", () => {
    for (let i = 0; i < 5; i++) rateLimit("test:block", 5, 60_000);
    const result = rateLimit("test:block", 5, 60_000);
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < 5; i++) rateLimit("test:reset", 5, 60_000);
    expect(rateLimit("test:reset", 5, 60_000).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("test:reset", 5, 60_000).ok).toBe(true);
  });

  it("different keys have independent buckets", () => {
    for (let i = 0; i < 5; i++) rateLimit("test:a", 5, 60_000);
    expect(rateLimit("test:b", 5, 60_000).ok).toBe(true);
  });
});

// ── 3. Invoice tax field validation ──────────────────────────

describe("Invoice billing address — US validation", () => {
  let billingAddressSchema: (typeof import("./invoice-tax"))["billingAddressSchema"];

  beforeAll(async () => {
    billingAddressSchema = (await import("./invoice-tax")).billingAddressSchema;
  });

  it("accepts a valid US address with EIN", () => {
    expect(billingAddressSchema.safeParse({ country: "US", line1: "123 Main St", city: "New York", state: "NY", zip: "10001", ein: "12-3456789" }).success).toBe(true);
  });

  it("accepts ZIP+4 format", () => {
    expect(billingAddressSchema.safeParse({ country: "US", line1: "1 Loop", city: "Cupertino", state: "CA", zip: "95014-2083" }).success).toBe(true);
  });

  it("rejects invalid state code", () => {
    expect(billingAddressSchema.safeParse({ country: "US", line1: "123 Main", city: "Faketown", state: "XX", zip: "12345" }).success).toBe(false);
  });

  it("rejects malformed ZIP", () => {
    expect(billingAddressSchema.safeParse({ country: "US", line1: "123 Main", city: "Chicago", state: "IL", zip: "ABCDE" }).success).toBe(false);
  });

  it("rejects malformed EIN", () => {
    expect(billingAddressSchema.safeParse({ country: "US", line1: "123 Main", city: "Chicago", state: "IL", zip: "60601", ein: "123456789" }).success).toBe(false);
  });
});

describe("Invoice billing address — India validation", () => {
  let billingAddressSchema: (typeof import("./invoice-tax"))["billingAddressSchema"];

  beforeAll(async () => {
    billingAddressSchema = (await import("./invoice-tax")).billingAddressSchema;
  });

  it("accepts a valid Indian address with GSTIN", () => {
    expect(billingAddressSchema.safeParse({ country: "IN", line1: "10 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", gstin: "29ABCDE1234F1Z5" }).success).toBe(true);
  });

  it("rejects a PIN code with letters", () => {
    expect(billingAddressSchema.safeParse({ country: "IN", line1: "10 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "56000X" }).success).toBe(false);
  });

  it("rejects malformed GSTIN", () => {
    expect(billingAddressSchema.safeParse({ country: "IN", line1: "10 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", gstin: "INVALID_GSTIN" }).success).toBe(false);
  });

  it("rejects HSN code with fewer than 4 digits", () => {
    expect(billingAddressSchema.safeParse({ country: "IN", line1: "10 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", hsnCode: "99" }).success).toBe(false);
  });
});

// ── 4. Webhook HMAC signature ─────────────────────────────────

describe("Webhook HMAC signature verification", () => {
  it("matching signature is valid", async () => {
    const { createHmac } = await import("crypto");
    const SECRET = "webhook-signing-secret";
    const body = JSON.stringify({ event: "subscription.renewed", timestamp: 1234567890 });
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(sig).toBe(createHmac("sha256", SECRET).update(body).digest("hex"));
  });

  it("tampered body produces different signature", async () => {
    const { createHmac } = await import("crypto");
    const SECRET = "webhook-signing-secret";
    const body = JSON.stringify({ event: "subscription.renewed", timestamp: 1234567890 });
    const tampered = JSON.stringify({ event: "subscription.cancelled", timestamp: 1234567890 });
    expect(createHmac("sha256", SECRET).update(body).digest("hex")).not.toBe(
      createHmac("sha256", SECRET).update(tampered).digest("hex"),
    );
  });

  it("wrong secret produces different signature", async () => {
    const { createHmac } = await import("crypto");
    const body = JSON.stringify({ event: "subscription.renewed" });
    expect(createHmac("sha256", "real-secret").update(body).digest("hex")).not.toBe(
      createHmac("sha256", "attacker-secret").update(body).digest("hex"),
    );
  });
});
