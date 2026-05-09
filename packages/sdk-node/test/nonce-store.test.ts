import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryNonceStore } from "../src/services/nonce-store";

describe("InMemoryNonceStore", () => {
  let store: InMemoryNonceStore;

  beforeEach(() => {
    store = new InMemoryNonceStore(60_000);
  });

  afterEach(() => {
    store.stop();
  });

  it("should allow a fresh nonce", async () => {
    const result = await store.markUsed("signer:1", 10_000);
    expect(result).toBe(true);
  });

  it("should reject a replayed nonce", async () => {
    await store.markUsed("signer:1", 10_000);
    const result = await store.markUsed("signer:1", 10_000);
    expect(result).toBe(false);
  });

  it("should allow different nonces for same signer", async () => {
    const first = await store.markUsed("signer:1", 10_000);
    const second = await store.markUsed("signer:2", 10_000);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("should allow same nonce for different signers", async () => {
    const first = await store.markUsed("alice:1", 10_000);
    const second = await store.markUsed("bob:1", 10_000);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("should report has() correctly", async () => {
    expect(await store.has("signer:1")).toBe(false);
    await store.markUsed("signer:1", 10_000);
    expect(await store.has("signer:1")).toBe(true);
  });

  it("should expire nonces after TTL", async () => {
    // Mark with very short TTL
    await store.markUsed("signer:1", 1);
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));
    // Should now be fresh
    const result = await store.markUsed("signer:1", 10_000);
    expect(result).toBe(true);
  });

  it("should handle multiple nonces without cross-contamination", async () => {
    const keys = Array.from({ length: 100 }, (_, i) => `signer:${i}`);
    for (const key of keys) {
      expect(await store.markUsed(key, 60_000)).toBe(true);
    }
    // All should now be seen
    for (const key of keys) {
      expect(await store.markUsed(key, 60_000)).toBe(false);
    }
  });
});
