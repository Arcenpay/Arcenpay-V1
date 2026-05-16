import { describe, it, expect } from "vitest";
import { verifyWebhookSignature } from "../src/services/webhooks";
import { createHmac } from "crypto";

describe("verifyWebhookSignature", () => {
  const secret = "test-secret-key-for-hmac";

  it("verifies a valid HMAC-SHA256 signature", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    expect(verifyWebhookSignature(body, "invalid-signature", secret)).toBe(
      false,
    );
  });

  it("rejects a signature with the wrong secret", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    const signature = createHmac("sha256", "wrong-secret")
      .update(body)
      .digest("hex");

    expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
  });

  it("accepts signatures with the sha256= header prefix", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWebhookSignature(body, `sha256=${signature}`, secret)).toBe(
      true,
    );
  });

  it("ignores surrounding whitespace on the secret and signature", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(
      verifyWebhookSignature(body, `  sha256=${signature}  `, `  ${secret}  `),
    ).toBe(true);
  });

  it("rejects malformed signatures before comparing", () => {
    const body = JSON.stringify({ event: "test", timestamp: 123 });
    expect(verifyWebhookSignature(body, "sha256=not-hex", secret)).toBe(false);
  });
});
