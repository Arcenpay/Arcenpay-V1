import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { WebhookService, verifyWebhookSignature } from "../src/services/webhooks.js";

test("verifyWebhookSignature accepts valid signatures and sha256 header prefix", () => {
  const secret = "test-secret-key-for-hmac";
  const body = JSON.stringify({ event: "subscription.renewed", timestamp: 123 });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyWebhookSignature(body, signature, secret), true);
  assert.equal(verifyWebhookSignature(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyWebhookSignature(body, "invalid-signature", secret), false);
});

test("WebhookService delivers a subscription event with signed payload", async () => {
  const deliveries: Array<{ url: string; body: string; signature: string }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    deliveries.push({
      url: String(input),
      body: String(init?.body ?? ""),
      signature: String((init?.headers as Record<string, string>)["X-ArcenPay-Signature"] ?? ""),
    });

    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const webhook = new WebhookService({
    url: "https://example.com/webhook",
    secret: "test-secret-key-for-hmac",
    maxRetries: 1,
  });

  try {
    await webhook.deliverEvent({
      type: "minted",
      tokenId: 42n,
      subscriber: "0x1234567890abcdef1234567890abcdef12345678",
      planId: 1n,
      expiration: 1_700_000_000n,
      transactionHash: "0xabc123",
      blockNumber: 100n,
      timestamp: 1_716_000_000,
    });
  } finally {
    webhook.stop();
    globalThis.fetch = originalFetch;
  }

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].url, "https://example.com/webhook");

  const payload = JSON.parse(deliveries[0].body) as {
    event: string;
    data: { tokenId: string; subscriber: string };
  };
  assert.equal(payload.event, "subscription.minted");
  assert.equal(payload.data.tokenId, "42");
  assert.equal(
    payload.data.subscriber,
    "0x1234567890abcdef1234567890abcdef12345678",
  );
  assert.equal(
    verifyWebhookSignature(
      deliveries[0].body,
      deliveries[0].signature,
      "test-secret-key-for-hmac",
    ),
    true,
  );
});
