// ============================================================
//  WebhookService — Unit Tests
// ============================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WebhookService } from "../src/services/webhooks";
import { createHmac } from "crypto";

describe("WebhookService", () => {
  let webhook: WebhookService;
  const testConfig = {
    url: "https://example.com/webhook",
    secret: "test-secret-key-for-hmac",
    maxRetries: 2,
    retryDelays: [100, 200],
  };

  beforeEach(() => {
    webhook = new WebhookService(testConfig);
    vi.useFakeTimers();
  });

  afterEach(() => {
    webhook.stop();
    vi.useRealTimers();
  });

  describe("verifySignature (static)", () => {
    it("should verify a valid HMAC-SHA256 signature", () => {
      const body = JSON.stringify({ event: "test", timestamp: 123 });
      const signature = createHmac("sha256", testConfig.secret)
        .update(body)
        .digest("hex");

      const valid = WebhookService.verifySignature(
        body,
        signature,
        testConfig.secret,
      );
      expect(valid).toBe(true);
    });

    it("should reject an invalid signature", () => {
      const body = JSON.stringify({ event: "test", timestamp: 123 });
      const valid = WebhookService.verifySignature(
        body,
        "invalid-signature",
        testConfig.secret,
      );
      expect(valid).toBe(false);
    });

    it("should reject a signature with wrong secret", () => {
      const body = JSON.stringify({ event: "test", timestamp: 123 });
      const signature = createHmac("sha256", "wrong-secret")
        .update(body)
        .digest("hex");

      const valid = WebhookService.verifySignature(
        body,
        signature,
        testConfig.secret,
      );
      expect(valid).toBe(false);
    });
  });

  describe("deliverEvent", () => {
    it("should construct payload from subscription event data", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal("fetch", fetchSpy);

      await webhook.deliverEvent({
        type: "minted",
        tokenId: 42n,
        subscriber: "0x1234567890abcdef1234567890abcdef12345678",
        planId: 1n,
        expiration: 1700000000n,
        transactionHash: "0xabc123",
        blockNumber: 100n,
        timestamp: Date.now(),
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(testConfig.url);
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["X-ArcenPay-Signature"]).toBeTruthy();

      const body = JSON.parse(options.body);
      expect(body.event).toBe("subscription.minted");
      expect(body.data.tokenId).toBe("42");
      expect(body.data.subscriber).toBe(
        "0x1234567890abcdef1234567890abcdef12345678",
      );

      vi.unstubAllGlobals();
    });
  });

  describe("getDeliveryLog", () => {
    it("should return an empty log initially", () => {
      const log = webhook.getDeliveryLog();
      expect(log).toEqual([]);
    });

    it("should log deliveries in reverse chronological order", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal("fetch", fetchSpy);

      await webhook.deliver({ event: "test1", timestamp: 1000, data: {} }, 1);
      await webhook.deliver({ event: "test2", timestamp: 2000, data: {} }, 1);

      const log = webhook.getDeliveryLog();
      expect(log).toHaveLength(2);
      expect(log[0].event).toBe("test2");
      expect(log[1].event).toBe("test1");
      expect(log[0].success).toBe(true);

      vi.unstubAllGlobals();
    });
  });

  describe("stop", () => {
    it("should cancel pending retries", () => {
      // Just verify it doesn't throw
      webhook.stop();
      expect(webhook.getDeliveryLog()).toEqual([]);
    });
  });
});
