import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../../../src/lib/redis.js", () => ({
  getRedis: () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    del: async (key: string) => {
      store.delete(key);
    },
  }),
}));

import {
  getCachedSession,
  setCachedSession,
  invalidateSessionCache,
} from "../../../src/lib/auth/session-cache.js";

const HASH = "hash-abc";

describe("session cache", () => {
  beforeEach(() => store.clear());

  it("revives the date fields that the expiry/revocation checks depend on", async () => {
    await setCachedSession(HASH, {
      id: "s1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      revokedAt: null,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });

    const cached = await getCachedSession<any>(HASH);
    expect(cached).not.toBeNull();
    // A string here would make `expiresAt <= now` always false, which would
    // silently accept expired sessions.
    expect(cached.expiresAt).toBeInstanceOf(Date);
    expect(cached.expiresAt.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    expect(cached.lastSeenAt).toBeInstanceOf(Date);
    expect(cached.revokedAt).toBeNull();
  });

  it("treats an unparseable date as a MISS, never a pass", async () => {
    store.set(
      `arcenpay:session:${HASH}`,
      JSON.stringify({ id: "s1", expiresAt: "not-a-date", revokedAt: null }),
    );

    expect(await getCachedSession(HASH)).toBeNull();
  });

  it("treats a record without expiresAt as a miss", async () => {
    store.set(
      `arcenpay:session:${HASH}`,
      JSON.stringify({ id: "s1", revokedAt: null }),
    );

    expect(await getCachedSession(HASH)).toBeNull();
  });

  it("falls back to a miss rather than throwing on malformed JSON", async () => {
    store.set(`arcenpay:session:${HASH}`, "{not json");

    expect(await getCachedSession(HASH)).toBeNull();
  });

  it("invalidateSessionCache removes the entry", async () => {
    await setCachedSession(HASH, { expiresAt: "2030-01-01T00:00:00.000Z" });
    await invalidateSessionCache(HASH);

    expect(await getCachedSession(HASH)).toBeNull();
  });
});
