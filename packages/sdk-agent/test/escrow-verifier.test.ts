import { describe, it, expect, vi } from "vitest";
import {
  computeExactHash,
  checkSchemaConformance,
  verifyCommitment,
  createProviderCommitment,
  ArcenAgent,
  type ProviderCommitment,
} from "../src";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("Verify-Then-Settle Escrow Verifier (Section 11)", () => {
  describe("computeExactHash", () => {
    it("should compute identical SHA-256 hashes regardless of object key order", () => {
      const objA = { alpha: 1, beta: "hello", nested: { y: 2, x: 1 } };
      const objB = { beta: "hello", alpha: 1, nested: { x: 1, y: 2 } };

      const hashA = computeExactHash(objA);
      const hashB = computeExactHash(objB);

      expect(hashA).toMatch(/^[0-9a-f]{64}$/);
      expect(hashA).toBe(hashB);
    });

    it("should compute different hashes for different payloads", () => {
      const hash1 = computeExactHash({ answer: 42 });
      const hash2 = computeExactHash({ answer: 43 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("checkSchemaConformance", () => {
    const schema = {
      required: ["status", "data", "count"],
      properties: {
        status: { type: "string" },
        count: { type: "number" },
        data: { type: "object" },
      },
      maxAgeSeconds: 60,
    };

    it("should validate conforming payloads", () => {
      const payload = {
        status: "ok",
        count: 5,
        data: { key: "value" },
        timestamp: new Date().toISOString(),
      };

      const result = checkSchemaConformance(payload, schema);
      expect(result.valid).toBe(true);
    });

    it("should reject payload missing required fields", () => {
      const payload = {
        status: "ok",
        // missing count and data
      };

      const result = checkSchemaConformance(payload, schema);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing required property");
    });

    it("should reject payload with mismatched types", () => {
      const payload = {
        status: "ok",
        count: "not-a-number",
        data: {},
      };

      const result = checkSchemaConformance(payload, schema);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Expected type 'number'");
    });

    it("should reject stale payload exceeding maxAgeSeconds", () => {
      const staleTimestamp = new Date(Date.now() - 120_000).toISOString(); // 2 mins ago
      const payload = {
        status: "ok",
        count: 1,
        data: {},
        timestamp: staleTimestamp,
      };

      const result = checkSchemaConformance(payload, schema);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Payload age exceeds maxAgeSeconds");
    });
  });

  describe("verifyCommitment", () => {
    it("should verify exact_hash match successfully", () => {
      const payload = { model: "gpt-4o", result: "Analysis complete", tokens: 150 };
      const hash = computeExactHash(payload);

      const commitment = createProviderCommitment({
        requestNonce: "nonce-101",
        resourceId: "https://api.provider.ai/inference",
        mode: "exact_hash",
        payloadOrHash: hash,
        providerSignature: "0x_provider_sig",
      });

      const verification = verifyCommitment(commitment, payload);
      expect(verification.valid).toBe(true);
      expect(verification.failureReason).toBeUndefined();
    });

    it("should detect hash mismatch in exact_hash mode", () => {
      const actualPayload = { result: "tampered or corrupted output" };
      const commitment = createProviderCommitment({
        requestNonce: "nonce-102",
        resourceId: "https://api.provider.ai/inference",
        mode: "exact_hash",
        payloadOrHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // empty sha
        providerSignature: "0x_provider_sig",
      });

      const verification = verifyCommitment(commitment, actualPayload);
      expect(verification.valid).toBe(false);
      expect(verification.failureReason).toBe("hash_mismatch");
      expect(verification.errorDetail).toBeDefined();
    });

    it("should verify schema_conformance mode", () => {
      const commitment: ProviderCommitment = {
        type: "ArcenProviderCommitment",
        requestNonce: "nonce-103",
        resourceId: "https://api.provider.ai/data",
        mode: "schema_conformance",
        commitment: "schema:v1:data-feed",
        timestamp: new Date().toISOString(),
        providerSignature: "0x_sig",
      };

      const validPayload = { id: "123", value: 42.0 };
      const schema = { required: ["id", "value"], properties: { id: { type: "string" }, value: { type: "number" } } };

      const resValid = verifyCommitment(commitment, validPayload, schema);
      expect(resValid.valid).toBe(true);

      const invalidPayload = { id: "123", value: "wrong-type" };
      const resInvalid = verifyCommitment(commitment, invalidPayload, schema);
      expect(resInvalid.valid).toBe(false);
      expect(resInvalid.failureReason).toBe("schema_violation");
    });
  });

  describe("Agent fetchEscrowed Integration", () => {
    it("should execute fetchEscrowed, verify commitment, and trigger early confirmSettlement", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_PRIVATE_KEY,
        rpcUrl: "https://sepolia.base.org",
        chainId: 84532,
      });

      const deliveredPayload = { status: "success", inference: "verified output" };
      const expectedHash = computeExactHash(deliveredPayload);

      // Mock global fetch for escrowed response
      const mockHeaders = new Headers();
      mockHeaders.set("x-arcen-commitment", `sha256:${expectedHash}`);
      mockHeaders.set("x-arcen-commitment-mode", "exact_hash");
      mockHeaders.set("x-arcen-commitment-sig", "0x_provider_signature_valid");
      mockHeaders.set("x-arcen-request-nonce", "req-escrow-001");

      const mockResponse = new Response(JSON.stringify(deliveredPayload), {
        status: 200,
        headers: mockHeaders,
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      const confirmSpy = vi.spyOn(agent, "confirmSettlement");

      const result = await agent.fetchEscrowed("https://api.provider.ai/run", {
        mode: "exact_hash",
      });

      expect(result.verified).toBe(true);
      expect(result.payload).toEqual(deliveredPayload);
      expect(confirmSpy).toHaveBeenCalledWith("req-escrow-001");
    });

    it("should trigger disputeSettlement automatically when deliverable fails verification", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_PRIVATE_KEY,
        rpcUrl: "https://sepolia.base.org",
        chainId: 84532,
      });

      const deliveredPayload = { garbage: "fraudulent output" };
      const differentHash = "1111111111111111111111111111111111111111111111111111111111111111";

      const mockHeaders = new Headers();
      mockHeaders.set("x-arcen-commitment", `sha256:${differentHash}`);
      mockHeaders.set("x-arcen-commitment-mode", "exact_hash");
      mockHeaders.set("x-arcen-commitment-sig", "0x_bad_sig");
      mockHeaders.set("x-arcen-request-nonce", "req-escrow-002");

      const mockResponse = new Response(JSON.stringify(deliveredPayload), {
        status: 200,
        headers: mockHeaders,
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      const disputeSpy = vi.spyOn(agent, "disputeSettlement");

      const result = await agent.fetchEscrowed("https://api.provider.ai/run", {
        mode: "exact_hash",
      });

      expect(result.verified).toBe(false);
      expect(disputeSpy).toHaveBeenCalledWith("req-escrow-002", expect.objectContaining({
        failureReason: "hash_mismatch",
      }));
      expect(result.disputeReceipt).toBeDefined();
      expect(result.disputeReceipt?.outcome).toBe("refunded");
    });
  });
});
