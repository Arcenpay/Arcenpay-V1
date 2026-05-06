import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSIWEMessage } from "..\/auth";

// ── buildSIWEMessage ──────────────────────────────────────────
describe("buildSIWEMessage", () => {
  it("produces a deterministic EIP-4361 message", () => {
    const issuedAt = "2026-03-04T12:00:00.000Z";
    const message = buildSIWEMessage({
      address: "0x1234567890123456789012345678901234567890",
      chainId: 11155111,
      nonce: "nonce-123",
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      issuedAt,
    });

    expect(message).toContain("Nonce: nonce-123");
    expect(message).toContain(`Issued At: ${issuedAt}`);
    expect(message).toContain("Chain ID: 11155111");
    expect(message).toContain("0x1234567890123456789012345678901234567890");
  });
});

// ── DB-backed nonce system ────────────────────────────────────
// The old in-memory generateNonce/consumeNonce have been replaced by
// the DB-backed versions in lib/nonce.server.ts. We mock the Prisma
// client so these tests run without a real database.

vi.mock("@/lib/db", () => {
  const records = new Map<string, {
    nonce: string;
    issuedAt: string;
    expiresAt: Date;
    usedAt: Date | null;
  }>();

  const authNonce = {
    create: vi.fn(async ({ data }) => {
      records.set(data.nonce, { ...data, usedAt: null });
      return data;
    }),
    findUnique: vi.fn(async ({ where }) => {
      return records.get(where.nonce) ?? null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const rec = records.get(where.nonce);
      if (rec) rec.usedAt = data.usedAt;
      return rec;
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const rec = records.get(where.nonce);
      if (!rec) return { count: 0 };
      if (rec.usedAt !== null) return { count: 0 };
      if (where.expiresAt?.gt && !(rec.expiresAt > where.expiresAt.gt)) {
        return { count: 0 };
      }

      rec.usedAt = data.usedAt;
      return { count: 1 };
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  };

  const db = {
    authNonce,
    $transaction: vi.fn(async (callback) => callback({ authNonce })),
  };

  return { db };
});

describe("DB-backed nonce (nonce.server.ts)", async () => {
  const { generateNonce, consumeNonce } = await import("../nonce.server");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateNonce returns a nonce and issuedAt", async () => {
    const { nonce, issuedAt } = await generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce).toHaveLength(32); // 16 bytes hex
    expect(issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("consumeNonce succeeds once and rejects replay", async () => {
    const { nonce } = await generateNonce();
    const first = await consumeNonce(nonce);
    const second = await consumeNonce(nonce);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("consumeNonce returns null for unknown nonce", async () => {
    const result = await consumeNonce("nonexistent-nonce");
    expect(result).toBeNull();
  });
});
