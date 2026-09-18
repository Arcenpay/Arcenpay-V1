import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

vi.mock("../../../src/db.js", () => ({
  db: {
    arcenApiKey: { findUnique: vi.fn(), update: vi.fn() },
    embedAccessToken: { findFirst: vi.fn() },
    arcenCompany: { findFirst: vi.fn() },
  },
}));

vi.mock("../../../src/lib/auth/arcjet.js", () => ({
  aj: { withRule: () => ({ protect: vi.fn(async () => ({ isDenied: () => false })) }) },
  fixedWindow: () => ({}),
}));

import {
  generateApiKey,
  generateTemporaryAccessToken,
  hashApiKey,
  requireApiKey,
  API_PERMISSIONS,
} from "../../../src/lib/auth/api-key-auth.js";
import { resolveEmbedAccessToken } from "../../../src/lib/entitlements/embed-access-token.js";
import { db } from "../../../src/db.js";

const mockDb = db as any;

function bearer(raw: string): Request {
  return new Request("https://api.example.com/v1/x", {
    headers: { Authorization: `Bearer ${raw}` },
  });
}

function keyRecord(raw: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    teamId: "team-1",
    environmentId: "env-1",
    type: "SECRET",
    permissions: [],
    revokedAt: null,
    expiresAt: null,
    environmentMode: "DEVELOPMENT",
    ...overrides,
  };
}

describe("Stripe-style API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.arcenApiKey.update.mockResolvedValue({ id: "key-1" });
  });

  it("generates the correct prefix per type and environment", () => {
    expect(generateApiKey({ type: "SECRET", mode: "PRODUCTION" }).raw.startsWith("sk_live_")).toBe(true);
    expect(generateApiKey({ type: "SECRET", mode: "DEVELOPMENT" }).raw.startsWith("sk_test_")).toBe(true);
    expect(generateApiKey({ type: "PUBLISHABLE", mode: "PRODUCTION" }).raw.startsWith("pk_live_")).toBe(true);
    expect(generateApiKey({ type: "PUBLISHABLE", mode: "DEVELOPMENT" }).raw.startsWith("pk_test_")).toBe(true);
    expect(generateApiKey({ type: "RESTRICTED", mode: "PRODUCTION" }).raw.startsWith("rk_live_")).toBe(true);
    expect(generateApiKey({ type: "RESTRICTED", mode: "DEVELOPMENT" }).raw.startsWith("rk_test_")).toBe(true);
  });

  it("hashes keys and only stores the prefix for display", () => {
    const { raw, hash, prefix } = generateApiKey({ type: "SECRET", mode: "DEVELOPMENT" });
    expect(hash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(prefix).toBe(raw.slice(0, 16));
    expect(raw).not.toContain(hash);
  });

  it("authenticates a valid secret key and returns the key context", async () => {
    const { raw } = generateApiKey({ type: "SECRET", mode: "DEVELOPMENT" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(keyRecord(raw));
    const result = await requireApiKey(bearer(raw));
    expect(result).toMatchObject({ teamId: "team-1", apiKeyId: "key-1", keyType: "SECRET" });
    expect(mockDb.arcenApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey(raw) },
      select: expect.anything(),
    });
  });

  it("rejects revoked and expired keys", async () => {
    const { raw } = generateApiKey({ type: "SECRET", mode: "DEVELOPMENT" });
    mockDb.arcenApiKey.findUnique.mockResolvedValueOnce(
      keyRecord(raw, { revokedAt: new Date() }),
    );
    expect((await requireApiKey(bearer(raw)))).toMatchObject({ status: 401 });

    mockDb.arcenApiKey.findUnique.mockResolvedValueOnce(
      keyRecord(raw, { expiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await requireApiKey(bearer(raw)))).toMatchObject({ status: 401 });
  });

  it("rejects publishable keys on endpoints that only allow secrets", async () => {
    const { raw } = generateApiKey({ type: "PUBLISHABLE", mode: "DEVELOPMENT" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(keyRecord(raw, { type: "PUBLISHABLE" }));
    const result = await requireApiKey(bearer(raw), { allow: ["SECRET", "RESTRICTED"] });
    expect(result).toMatchObject({ status: 403 });
  });

  it("accepts publishable keys on client-safe endpoints", async () => {
    const { raw } = generateApiKey({ type: "PUBLISHABLE", mode: "DEVELOPMENT" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(
      keyRecord(raw, { type: "PUBLISHABLE", permissions: [] }),
    );
    const result = await requireApiKey(bearer(raw), {
      allow: ["PUBLISHABLE", "SECRET"],
      permissions: ["entitlements.read"],
    });
    expect(result).toMatchObject({ keyType: "PUBLISHABLE" });
  });

  it("enforces permissions on restricted keys and grants full access to unrestricted secrets", async () => {
    const { raw } = generateApiKey({ type: "RESTRICTED", mode: "DEVELOPMENT" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(
      keyRecord(raw, { type: "RESTRICTED", permissions: ["entitlements.read"] }),
    );
    // Has the permission -> allowed
    let result = await requireApiKey(bearer(raw), {
      allow: ["SECRET", "RESTRICTED"],
      permissions: ["entitlements.read"],
    });
    expect(result).toMatchObject({ keyType: "RESTRICTED" });

    // Missing permission -> 403
    result = await requireApiKey(bearer(raw), {
      allow: ["SECRET", "RESTRICTED"],
      permissions: ["payments.write"],
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it("exposes a curated permission catalog", () => {
    for (const permission of API_PERMISSIONS) {
      expect(typeof permission).toBe("string");
      expect(permission).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it("mints arc_tok_ temporary access tokens that resolve to a company", async () => {
    const tk = generateTemporaryAccessToken();
    expect(tk.raw.startsWith("arc_tok_")).toBe(true);
    expect(tk.hash).toBe(hashApiKey(tk.raw));

    mockDb.embedAccessToken.findFirst.mockResolvedValue({
      teamId: "team-1",
      environmentId: "env-1",
      companyId: "company-1",
      userId: null,
    });
    mockDb.arcenCompany.findFirst.mockResolvedValue({ id: "company-1" });

    const context = await resolveEmbedAccessToken(tk.raw);
    expect(context).toMatchObject({
      teamId: "team-1",
      companyId: "company-1",
      environmentId: "env-1",
    });

    // Missing/expired row -> null
    mockDb.embedAccessToken.findFirst.mockResolvedValueOnce(null);
    expect(await resolveEmbedAccessToken(tk.raw)).toBeNull();
  });
});
