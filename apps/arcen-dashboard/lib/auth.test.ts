import { describe, it, expect } from "vitest";
import { buildSIWEMessage, consumeNonce, generateNonce } from "./auth";

describe("SIWE auth helpers", () => {
  it("consumes nonce once and rejects replay", () => {
    const { nonce } = generateNonce();
    const firstUse = consumeNonce(nonce);
    const secondUse = consumeNonce(nonce);

    expect(firstUse).not.toBeNull();
    expect(secondUse).toBeNull();
  });

  it("builds deterministic message with provided issuedAt", () => {
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
  });
});
