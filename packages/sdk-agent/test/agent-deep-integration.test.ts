// ============================================================
//  @arcenpay/agent — Comprehensive Agent Verification Tests
//  Validates end-to-end agent capabilities:
//  1. Multi-chain (BOT Chain 677/968, Base, Arc, Sepolia, Stellar)
//  2. Budget controls (maxPrice, maxAutoApprove, maxDailySpend)
//  3. Spending tracking & accounting (dailySpent, totalSpent, getSpendSummary)
//  4. Payment Link discovery & slug resolution across URL shapes
//  5. On-chain payment execution (EVM ERC-20 & Stellar SAC)
//  6. Programmatic link creation with auth & defaults
//  7. x402 Auto-Payment Negotiation via agent.fetch()
//  8. Full MCP Tool Dispatcher & error handling
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArcenAgent, MEAPAgent } from "../src/agent";
import { createArcenAgentMcpTools, ARCENPAY_MCP_TOOL_DEFINITIONS } from "../src/mcp-tools";
import { getTokenAddress, STELLAR_TESTNET_CHAIN_ID } from "../src/internal/core";
import type { AgenticPaymentLinkSpec } from "../src/internal/core";
import { Keypair } from "@stellar/stellar-sdk";

const TEST_EVM_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MOCK_BOT_SPEC: AgenticPaymentLinkSpec = {
  type: "agentic_payment_link",
  version: "1.0",
  id: "pl_bot_001",
  slug: "pl_bot_001",
  name: "BOT Chain AI Inference Feed",
  description: "High-speed inference execution on BOT Chain",
  status: "ACTIVE",
  isAgentic: true,
  amount: "5.000000",
  amountAtomic: "5000000",
  currency: "USDT",
  acceptedToken: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
  chainId: 677,
  chainFamily: "evm",
  recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  expiresAt: null,
  sessionUrl: "https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/session",
  confirmUrl: "https://api.arcenpay.xyz/api/v1/public/checkout/:sessionId/confirm",
  metadata: null,
};

describe("ArcenAgent — Comprehensive Real-World SDK Verification", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─── 1. Multi-Chain Initialization & Token Resolution ──────────
  describe("Multi-Chain Support (including BOT Chain & Stellar)", () => {
    it("should initialize on BOT Mainnet (677) and resolve USDT token", () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
      });

      expect(agent.address.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
      const usdtAddress = getTokenAddress(677, "USDT");
      expect(usdtAddress?.toLowerCase()).toBe("0xababc7ddc03e501d190c676bf3d92ef0e6e87a3c");
      // BOT Mainnet only has USDT — USDC is not deployed on this chain
      expect(getTokenAddress(677, "USDC")).toBeUndefined();
    });

    it("should initialize on BOT Testnet (968)", () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.bohr.life",
        chainId: 968,
      });

      expect(agent).toBeDefined();
      const usdtAddress = getTokenAddress(968, "USDT");
      expect(usdtAddress?.toLowerCase()).toBe("0x75edc9335175fc0552d51d48439f229c10420fe3");
    });

    it("should initialize on Stellar Testnet with S... secret key", () => {
      const kp = Keypair.random();
      const agent = new ArcenAgent({
        privateKey: kp.secret(),
        chainId: STELLAR_TESTNET_CHAIN_ID,
      });

      expect(agent.address).toBe(kp.publicKey());
      expect(agent.address.startsWith("G")).toBe(true);
    });

    it("should maintain MEAPAgent alias backward compatibility", () => {
      expect(MEAPAgent).toBe(ArcenAgent);
    });
  });

  // ─── 2. Budget Controls & Spend Accounting ─────────────────────
  describe("Budget Guardrails & Spending Accounting", () => {
    it("should initialize with maxDailySpend and report zero spend initially", () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
        maxDailySpend: "10.00",
        maxAutoApprove: "2.00",
      });

      expect(agent.getDailySpendLimit()).toBe(10_000_000n);
      expect(agent.getDailySpent()).toBe(0n);
      expect(agent.getTotalSpent()).toBe(0n);

      const summary = agent.getSpendSummary();
      expect(summary.dailySpent).toBe("$0 USDC");
      expect(summary.totalSpent).toBe("$0 USDC");
      expect(summary.dailyLimit).toBe("$10 USDC");
      expect(summary.maxAutoApprove).toBe("2.00");
    });

    it("should reject payment link if amount pushes cumulative spend over maxDailySpend", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
        maxDailySpend: "6.00", // Daily budget $6
        maxAutoApprove: "10.00",
      });

      // Mock spec for 5.00 USDT
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ spec: MOCK_BOT_SPEC }),
      } as Response);

      // Simulate prior spend of $2.00
      (agent as any).dailySpent = 2_000_000n;

      // 2.00 + 5.00 = 7.00 > 6.00 limit -> Must reject
      await expect(agent.payPaymentLink("pl_bot_001")).rejects.toThrow(
        /Daily spend limit reached/,
      );
    });

    it("should update dailySpent and totalSpent accurately upon successful payment", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
        maxDailySpend: "20.00",
        maxAutoApprove: "10.00",
      });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/spec")) {
          return { ok: true, json: async () => ({ spec: MOCK_BOT_SPEC }) } as Response;
        }
        if (url.includes("/session")) {
          return {
            ok: true,
            json: async () => ({
              checkoutSession: {
                id: "cs_bot_test_session",
                amount: 5,
                recipientWallet: MOCK_BOT_SPEC.recipientWallet,
              },
            }),
          } as Response;
        }
        if (url.includes("/confirm")) {
          return {
            ok: true,
            json: async () => ({
              confirmed: true,
              payment: { id: "pm_bot_done", status: "SUCCEEDED" },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const writeContractSpy = vi.fn().mockResolvedValue("0xbotchain_tx_hash_123");
      (agent as any).walletClient = { writeContract: writeContractSpy };
      (agent as any).publicClient = null;

      const receipt = await agent.payPaymentLink("pl_bot_001");
      expect(receipt.success).toBe(true);
      expect(receipt.txHash).toBe("0xbotchain_tx_hash_123");
      expect(receipt.amount).toBe("5.000000");

      // Check accounting
      expect(agent.getDailySpent()).toBe(5_000_000n);
      expect(agent.getTotalSpent()).toBe(5_000_000n);

      const summary = agent.getSpendSummary();
      expect(summary.dailySpent).toBe("$5 USDC");
      expect(summary.totalSpent).toBe("$5 USDC");
    });
  });

  // ─── 3. URL and Slug Discovery Resolution ──────────────────────
  describe("URL & Slug Resolution Flexibility", () => {
    it("should resolve clean slug, slug with slash, query params, and full URLs", async () => {
      const urlsCalled: string[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        urlsCalled.push(url);
        return {
          ok: true,
          json: async () => ({ spec: MOCK_BOT_SPEC }),
        } as Response;
      });

      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        chainId: 677,
        apiUrl: "https://api.arcenpay.xyz",
      });

      // 1. Plain slug
      await agent.resolvePaymentLink("pl_bot_001");
      expect(urlsCalled[0]).toBe("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");

      // 2. Slug with trailing slash
      await agent.resolvePaymentLink("pl_bot_001/");
      expect(urlsCalled[1]).toBe("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");

      // 3. Slug with query params
      await agent.resolvePaymentLink("pl_bot_001?ref=agent007");
      expect(urlsCalled[2]).toBe("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");

      // 4. Hosted checkout URL
      await agent.resolvePaymentLink("https://pay.arcenpay.com/pay/pl_bot_001");
      expect(urlsCalled[3]).toBe("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");

      // 5. Direct spec URL
      await agent.resolvePaymentLink("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");
      expect(urlsCalled[4]).toBe("https://api.arcenpay.xyz/api/v1/public/payment-links/pl_bot_001/spec");
    });
  });

  // ─── 4. Stellar SAC Payment Execution ──────────────────────────
  describe("Stellar SAC Payment Execution", () => {
    it("should execute Stellar SAC transfer when paying Stellar link", async () => {
      const kp = Keypair.random();
      const agent = new ArcenAgent({
        privateKey: kp.secret(),
        chainId: STELLAR_TESTNET_CHAIN_ID,
        maxAutoApprove: "10.00",
      });

      const stellarSpec: AgenticPaymentLinkSpec = {
        type: "agentic_payment_link",
        version: "1.0",
        id: "pl_stellar_01",
        slug: "pl_stellar_01",
        name: "Stellar Service",
        status: "ACTIVE",
        isAgentic: true,
        amount: "1.500000",
        amountAtomic: "1500000",
        currency: "USDC",
        acceptedToken: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        chainId: STELLAR_TESTNET_CHAIN_ID,
        chainFamily: "stellar",
        recipientWallet: Keypair.random().publicKey(),
        expiresAt: null,
        sessionUrl: "https://api.arcenpay.xyz/api/v1/public/payment-links/pl_stellar_01/session",
        confirmUrl: "https://api.arcenpay.xyz/api/v1/public/checkout/:sessionId/confirm",
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/spec")) {
          return { ok: true, json: async () => ({ spec: stellarSpec }) } as Response;
        }
        if (url.includes("/session")) {
          return {
            ok: true,
            json: async () => ({
              checkoutSession: {
                id: "cs_stellar_session_1",
                amount: 1.5,
                recipientWallet: stellarSpec.recipientWallet,
              },
            }),
          } as Response;
        }
        if (url.includes("/confirm")) {
          return {
            ok: true,
            json: async () => ({
              confirmed: true,
              payment: { id: "pm_stellar_done", status: "SUCCEEDED" },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      // Mock sendStellarSacTransfer
      const sacTransferSpy = vi
        .spyOn(agent as any, "sendStellarSacTransfer")
        .mockResolvedValue("mock_stellar_tx_hash_67890");

      const receipt = await agent.payPaymentLink("pl_stellar_01");

      expect(receipt.success).toBe(true);
      expect(receipt.txHash).toBe("mock_stellar_tx_hash_67890");
      expect(receipt.chainFamily).toBe("stellar");
      expect(receipt.payerWallet).toBe(kp.publicKey());
      expect(sacTransferSpy).toHaveBeenCalledWith(
        stellarSpec.recipientWallet,
        "1.500000",
        "USDC",
        stellarSpec.acceptedToken,
      );
    });
  });

  // ─── 5. Programmatic Link Creation with API Key ────────────────
  describe("Programmatic Payment Link Creation", () => {
    it("should pass Bearer auth and payload defaults to createPaymentLink", async () => {
      let capturedHeaders: HeadersInit | undefined;
      let capturedBody: any;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          json: async () => ({
            spec: {
              ...MOCK_BOT_SPEC,
              name: capturedBody.title,
              amount: String(capturedBody.amount),
            },
          }),
        } as Response;
      });

      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        chainId: 677,
        apiUrl: "https://api.arcenpay.xyz",
        apiKey: "arcn_live_key_999",
      });

      const newLink = await agent.createPaymentLink({
        title: "Autonomous Agent Weather Data Feed",
        amount: 3.5,
        currency: "USDT",
        description: "High resolution telemetry",
      });

      expect((capturedHeaders as Record<string, string>)["Authorization"]).toBe("Bearer arcn_live_key_999");
      expect(capturedBody.title).toBe("Autonomous Agent Weather Data Feed");
      expect(capturedBody.amount).toBe(3.5);
      expect(capturedBody.isAgentic).toBe(true);
      expect(capturedBody.chainId).toBe(677);
      expect(capturedBody.recipientWallet.toLowerCase()).toBe(agent.address.toLowerCase());
      expect(newLink.name).toBe("Autonomous Agent Weather Data Feed");
    });
  });

  // ─── 6. x402 Auto-Payment via agent.fetch() ────────────────────
  describe("x402 Protocol Payment Flow", () => {
    it("should successfully negotiate 402 challenge and sign payment header", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://sepolia.base.org",
        chainId: 84532,
        maxAutoApprove: "1.00",
      });

      // Mock session balance to 10 USDC
      vi.spyOn(agent, "getBalance").mockResolvedValue(10_000_000n);

      let attempt = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        attempt++;
        if (attempt === 1) {
          // First attempt returns 402 Payment Required
          return {
            status: 402,
            ok: false,
            json: async () => ({
              error: "Payment required for premium resource",
              accepts: [
                {
                  scheme: "x402",
                  network: "baseSepolia",
                  chainId: 84532,
                  maxAmountRequired: "10000", // 0.01 USDC
                  resource: "https://api.example.com/premium-data",
                  recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                },
              ],
            }),
          } as Response;
        }

        // Second attempt with X-PAYMENT header
        const xPayment = (init?.headers as Record<string, string>)?.["X-PAYMENT"];
        expect(xPayment).toBeDefined();

        return {
          status: 200,
          ok: true,
          json: async () => ({ data: "unlocked_secret_content" }),
        } as Response;
      });

      const response = await agent.fetch("https://api.example.com/premium-data");
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.data).toBe("unlocked_secret_content");

      // Verify spend ledger updated
      expect(agent.getTotalSpent()).toBe(10000n);
      expect(agent.getDailySpent()).toBe(10000n);
    });
  });

  // ─── 7. Complete MCP Tools Suite ──────────────────────────────
  describe("Model Context Protocol (MCP) Tools Full Execution", () => {
    it("should handle arcenpay_pay_payment_link tool execution via dispatcher", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
      });

      const mockReceipt = {
        success: true,
        sessionId: "cs_mcp_test",
        txHash: "0xmcp_tx_123",
        amount: "5.000000",
        currency: "USDT",
        chainId: 677,
      };

      vi.spyOn(agent, "payPaymentLink").mockResolvedValue(mockReceipt as any);

      const mcp = createArcenAgentMcpTools(agent);
      const res = await mcp.handleToolCall("arcenpay_pay_payment_link", {
        urlOrSlug: "pl_bot_001",
        maxPrice: "10.00",
      });

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.txHash).toBe("0xmcp_tx_123");
    });

    it("should handle arcenpay_create_payment_link tool execution via dispatcher", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
      });

      vi.spyOn(agent, "createPaymentLink").mockResolvedValue({
        ...MOCK_BOT_SPEC,
        name: "MCP Created Link",
      });

      const mcp = createArcenAgentMcpTools(agent);
      const res = await mcp.handleToolCall("arcenpay_create_payment_link", {
        title: "MCP Created Link",
        amount: 5.0,
      });

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.name).toBe("MCP Created Link");
    });

    it("should gracefully handle errors in MCP tool dispatching", async () => {
      const agent = new ArcenAgent({
        privateKey: TEST_EVM_PRIVATE_KEY,
        rpcUrl: "https://rpc.botchain.ai",
        chainId: 677,
      });

      const mcp = createArcenAgentMcpTools(agent);

      // Missing urlOrSlug
      const res1 = await mcp.handleToolCall("arcenpay_resolve_payment_link", {});
      expect(res1.isError).toBe(true);
      expect(res1.content[0].text).toContain("Missing required argument");

      // Invalid create args
      const res2 = await mcp.handleToolCall("arcenpay_create_payment_link", { title: "" });
      expect(res2.isError).toBe(true);
      expect(res2.content[0].text).toContain("Invalid arguments");

      // Unknown tool
      const res3 = await mcp.handleToolCall("non_existent_tool", {});
      expect(res3.isError).toBe(true);
      expect(res3.content[0].text).toContain("Unknown MCP tool");
    });
  });
});
