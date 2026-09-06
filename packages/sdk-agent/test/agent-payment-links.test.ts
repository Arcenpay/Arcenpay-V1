import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArcenAgent } from "../src/agent";
import { createArcenAgentMcpTools, ARCENPAY_MCP_TOOL_DEFINITIONS } from "../src/mcp-tools";
import type { AgenticPaymentLinkSpec } from "../src/internal/core";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MOCK_SPEC: AgenticPaymentLinkSpec = {
  type: "agentic_payment_link",
  version: "1.0",
  id: "pl_test_123",
  slug: "pl_test_123",
  name: "AI Market Data API Access",
  description: "1-hour access token for AI financial dataset",
  status: "ACTIVE",
  isAgentic: true,
  amount: "2.500000",
  amountAtomic: "2500000",
  currency: "USDC",
  acceptedToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  chainId: 84532,
  chainFamily: "evm",
  recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  expiresAt: null,
  sessionUrl: "https://api.arcenpay.xyz/api/v1/public/payment-links/pl_test_123/session",
  confirmUrl: "https://api.arcenpay.xyz/api/v1/public/checkout/:sessionId/confirm",
  metadata: null,
};

describe("ArcenAgent — Agentic Payment Links", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should resolve a payment link specification by slug", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Accept: "application/json" });
      return {
        ok: true,
        json: async () => ({ spec: MOCK_SPEC }),
      } as Response;
    });

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
      apiUrl: "https://api.arcenpay.xyz",
    });

    const spec = await agent.resolvePaymentLink("pl_test_123");
    expect(spec.id).toBe("pl_test_123");
    expect(spec.amount).toBe("2.500000");
    expect(spec.currency).toBe("USDC");
    expect(spec.isAgentic).toBe(true);
  });

  it("should reject payment if chain ID does not match", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ spec: MOCK_SPEC }),
    } as Response);

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "http://localhost:8545",
      chainId: 11155111, // Sepolia (mismatches 84532)
    });

    await expect(agent.payPaymentLink("pl_test_123")).rejects.toThrow(
      /Chain mismatch/,
    );
  });

  it("should reject payment if amount exceeds maxPrice limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ spec: MOCK_SPEC }), // Amount is 2.50 USDC
    } as Response);

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
    });

    await expect(
      agent.payPaymentLink("pl_test_123", { maxPrice: "1.00" }),
    ).rejects.toThrow(/exceeds maxPrice limit/);
  });

  it("should reject payment if amount exceeds default maxAutoApprove", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ spec: MOCK_SPEC }), // 2.50 USDC
    } as Response);

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
      maxAutoApprove: "0.50",
    });

    await expect(agent.payPaymentLink("pl_test_123")).rejects.toThrow(
      /exceeds agent maxAutoApprove limit/,
    );
  });

  it("should execute payment flow and return receipt when approved", async () => {
    const mockSession = {
      id: "cs_mock_123",
      amount: 2.5,
      recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      successUrl: "https://example.com/success",
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/spec")) {
        return {
          ok: true,
          json: async () => ({ spec: MOCK_SPEC }),
        } as Response;
      }
      if (url.includes("/session")) {
        return {
          ok: true,
          json: async () => ({ checkoutSession: mockSession }),
        } as Response;
      }
      if (url.includes("/confirm")) {
        return {
          ok: true,
          json: async () => ({
            confirmed: true,
            payment: { id: "pm_mock_999", status: "SUCCEEDED" },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
      maxAutoApprove: "5.00",
    });

    // Mock walletClient.writeContract
    const writeContractSpy = vi.fn().mockResolvedValue("0xmocktxhash1234567890abcdef");
    (agent as any).walletClient = {
      writeContract: writeContractSpy,
    };
    (agent as any).publicClient = null;

    const receipt = await agent.payPaymentLink("pl_test_123");

    expect(receipt.success).toBe(true);
    expect(receipt.txHash).toBe("0xmocktxhash1234567890abcdef");
    expect(receipt.amount).toBe("2.500000");
    expect(receipt.currency).toBe("USDC");
    expect(receipt.recipientWallet).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(writeContractSpy).toHaveBeenCalledTimes(1);
  });

  it("should create an agentic payment link", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.isAgentic).toBe(true);
      expect(body.title).toBe("Agent Data Feed");
      expect(body.amount).toBe(1.25);
      return {
        ok: true,
        json: async () => ({
          spec: {
            ...MOCK_SPEC,
            name: body.title,
            amount: "1.250000",
          },
        }),
      } as Response;
    });

    const agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
      apiKey: "test_api_key",
    });

    const result = await agent.createPaymentLink({
      title: "Agent Data Feed",
      amount: 1.25,
    });

    expect(result.name).toBe("Agent Data Feed");
    expect(result.amount).toBe("1.250000");
  });

  describe("MCP Tools", () => {
    it("should export MCP tool definitions with schemas", () => {
      expect(ARCENPAY_MCP_TOOL_DEFINITIONS).toHaveLength(12);
      const names = ARCENPAY_MCP_TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain("arcenpay_resolve_payment_link");
      expect(names).toContain("arcenpay_pay_payment_link");
      expect(names).toContain("arcenpay_create_payment_link");
      expect(names).toContain("arcenpay_get_spend_summary");
      expect(names).toContain("arcenpay_issue_mandate");
      expect(names).toContain("arcenpay_check_policy");
      expect(names).toContain("arcenpay_revoke_mandate");
      expect(names).toContain("arcenpay_mandate_status");
      expect(names).toContain("arcenpay_fetch_escrowed");
      expect(names).toContain("arcenpay_verify_commitment");
      expect(names).toContain("arcenpay_dispute_claim");
      expect(names).toContain("arcenpay_settlement_status");
    });

    it("should handle MCP tool calls through dispatcher", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_PRIVATE_KEY,
        rpcUrl: "https://sepolia.base.org",
        chainId: 84532,
      });

      vi.spyOn(agent, "resolvePaymentLink").mockResolvedValue(MOCK_SPEC);

      const mcp = createArcenAgentMcpTools(agent);
      const res = await mcp.handleToolCall("arcenpay_resolve_payment_link", {
        urlOrSlug: "pl_test_123",
      });

      expect(res.isError).toBeFalsy();
      expect(res.content[0].type).toBe("text");
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.id).toBe("pl_test_123");

      // Test arcenpay_get_spend_summary via MCP
      const summaryRes = await mcp.handleToolCall("arcenpay_get_spend_summary", {});
      expect(summaryRes.isError).toBeFalsy();
      const summary = JSON.parse(summaryRes.content[0].text);
      expect(summary.dailySpent).toBe("$0 USDC");
      expect(summary.totalSpent).toBe("$0 USDC");
    });
  });
});
