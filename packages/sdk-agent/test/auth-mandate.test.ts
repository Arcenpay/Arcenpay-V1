import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createAgentMandate,
  signAgentMandate,
  verifyAgentMandate,
  isScopeSubset,
  type MandateScope,
} from "../src/auth/mandate";

// Deterministic test keys
const EVM_TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EVM_TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const STELLAR_KEYPAIR = Keypair.random();
const STELLAR_SECRET = STELLAR_KEYPAIR.secret();
const STELLAR_PUBLIC = STELLAR_KEYPAIR.publicKey();

describe("ArcenAuth Mandate System (Layer 3)", () => {
  describe("Mandate Creation & Structure", () => {
    it("should generate a valid unsigned mandate with default settings", () => {
      const mandate = createAgentMandate({
        issuer: {
          kind: "human_wallet",
          address: EVM_TEST_ADDRESS,
          chainId: 84532,
        },
        subject: {
          kind: "agent",
          agentId: "agent-alpha-001",
          publicKey: "0x1234567890123456789012345678901234567890",
        },
        scope: {
          maxPerTxn: "5.0",
          maxDaily: "25.0",
          maxTotal: "100.0",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      expect(mandate.type).toBe("ArcenPayAgentMandate");
      expect(mandate.version).toBe("1.0");
      expect(mandate.mandateId).toMatch(/^aam_[0-9a-f]{16}$/);
      expect(mandate.scope.maxPerTxn).toBe("5.0");
      expect(mandate.scope.allowedTokens).toEqual(["USDC", "USDT"]);
      expect(mandate.revocation?.method).toBe("offchain_endpoint");
      expect(mandate.issuedAt).toBeDefined();
    });
  });

  describe("Cryptographic Signing & Verification", () => {
    it("should sign and verify an EVM EIP-712 typed mandate", async () => {
      const unsigned = createAgentMandate({
        issuer: {
          kind: "human_wallet",
          address: EVM_TEST_ADDRESS,
          chainId: 84532,
        },
        subject: {
          kind: "agent",
          agentId: "agent-evm-01",
          publicKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        },
        scope: {
          maxPerTxn: "10.0",
          maxDaily: "50.0",
          maxTotal: "200.0",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      });

      const signed = await signAgentMandate(unsigned, EVM_TEST_PRIVATE_KEY, 84532);
      expect(signed.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

      const verification = await verifyAgentMandate(signed);
      expect(verification.valid).toBe(true);
      expect(verification.recoveredIssuer?.toLowerCase()).toBe(EVM_TEST_ADDRESS.toLowerCase());
    });

    it("should reject an EVM mandate if tampered after signing", async () => {
      const unsigned = createAgentMandate({
        issuer: {
          kind: "human_wallet",
          address: EVM_TEST_ADDRESS,
          chainId: 84532,
        },
        subject: {
          kind: "agent",
          agentId: "agent-evm-tamper",
          publicKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        },
        scope: {
          maxPerTxn: "10.0",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      const signed = await signAgentMandate(unsigned, EVM_TEST_PRIVATE_KEY, 84532);
      
      // Tamper with maxPerTxn (attacker attempts to increase allowance)
      const tampered = {
        ...signed,
        scope: {
          ...signed.scope,
          maxPerTxn: "999.0",
        },
      };

      const verification = await verifyAgentMandate(tampered);
      expect(verification.valid).toBe(false);
    });

    it("should sign and verify a Stellar Ed25519 mandate", async () => {
      const unsigned = createAgentMandate({
        issuer: {
          kind: "human_wallet",
          address: STELLAR_PUBLIC,
          chainId: 148,
        },
        subject: {
          kind: "agent",
          agentId: "agent-stellar-01",
          publicKey: Keypair.random().publicKey(),
        },
        scope: {
          maxPerTxn: "2.5",
          maxDaily: "10.0",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      const signed = await signAgentMandate(unsigned, STELLAR_SECRET, 148);
      expect(signed.signature.startsWith("stellar:")).toBe(true);

      const verification = await verifyAgentMandate(signed);
      expect(verification.valid).toBe(true);
      expect(verification.recoveredIssuer).toBe(STELLAR_PUBLIC);
    });
  });

  describe("Delegation Chain Scope Narrowing (isScopeSubset)", () => {
    const parentScope: MandateScope = {
      maxPerTxn: "10.0",
      maxDaily: "50.0",
      maxTotal: "200.0",
      allowedTokens: ["USDC", "USDT"],
      allowedChains: [8453, 84532],
      allowedResourceDomains: ["api.openai.com", "*.anthropic.com"],
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2026-12-31T23:59:59Z",
    };

    it("should allow a valid child scope strictly narrower than parent", () => {
      const childScope: MandateScope = {
        maxPerTxn: "5.0",
        maxDaily: "20.0",
        maxTotal: "100.0",
        allowedTokens: ["USDC"],
        allowedChains: [84532],
        allowedResourceDomains: ["api.openai.com"],
        validFrom: "2026-02-01T00:00:00Z",
        validUntil: "2026-06-01T00:00:00Z",
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(true);
    });

    it("should reject child if maxPerTxn exceeds parent", () => {
      const childScope: MandateScope = {
        ...parentScope,
        maxPerTxn: "15.0", // Exceeds parent 10.0
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("maxPerTxn");
    });

    it("should reject child if maxDaily exceeds parent", () => {
      const childScope: MandateScope = {
        ...parentScope,
        maxDaily: "60.0", // Exceeds parent 50.0
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("maxDaily");
    });

    it("should reject child if it introduces unpermitted tokens", () => {
      const childScope: MandateScope = {
        ...parentScope,
        allowedTokens: ["USDC", "DAI"], // DAI not allowed in parent
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("DAI");
    });

    it("should reject child if domain is broader or outside parent domains", () => {
      const childScope: MandateScope = {
        ...parentScope,
        allowedResourceDomains: ["evil-corp.com"],
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("evil-corp.com");
    });

    it("should reject child if validUntil extends past parent expiry", () => {
      const childScope: MandateScope = {
        ...parentScope,
        validUntil: "2027-01-01T00:00:00Z", // Past parent 2026-12-31
      };

      const result = isScopeSubset(childScope, parentScope);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("validUntil");
    });
  });
});
