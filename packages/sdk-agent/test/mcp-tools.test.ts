import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArcenAgent } from "../src/agent";
import {
  createArcenAgentMcpTools,
  ARCENPAY_MCP_TOOL_DEFINITIONS,
} from "../src/mcp-tools";
import type {
  AgenticPaymentLinkSpec,
  AgentPaymentReceipt,
  ArcenPayAgentMandate,
  ProviderCommitment,
  DisputeReceipt,
} from "../src/internal/core";

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
  chainId: 8453,
  chainFamily: "evm",
  recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  expiresAt: null,
  sessionUrl: "https://api.arcenpay.xyz/api/v1/public/payment-links/pl_test_123/session",
  confirmUrl: "https://api.arcenpay.xyz/api/v1/public/checkout/:sessionId/confirm",
  metadata: null,
};

const MOCK_RECEIPT: AgentPaymentReceipt = {
  success: true,
  sessionId: "sess_123",
  paymentLinkId: "pl_test_123",
  paymentLinkSlug: "pl_test_123",
  txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  amount: "2.500000",
  currency: "USDC",
  chainId: 8453,
  chainFamily: "evm",
  payerWallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  timestamp: new Date().toISOString(),
};

describe("MCP Tools Suite — 15 Production Tools", () => {
  let agent: ArcenAgent;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      chainId: 8453,
      apiUrl: "https://api.arcenpay.xyz",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should define exactly 15 standard MCP tools with valid schemas", () => {
    expect(ARCENPAY_MCP_TOOL_DEFINITIONS).toHaveLength(15);
    const names = ARCENPAY_MCP_TOOL_DEFINITIONS.map((t) => t.name);

    expect(names).toEqual([
      "arcenpay_resolve_payment_link",
      "arcenpay_pay_payment_link",
      "arcenpay_create_payment_link",
      "arcenpay_get_spend_summary",
      "arcenpay_check_balance",
      "arcenpay_fund_session",
      "arcenpay_fetch",
      "arcenpay_issue_mandate",
      "arcenpay_check_policy",
      "arcenpay_revoke_mandate",
      "arcenpay_mandate_status",
      "arcenpay_fetch_escrowed",
      "arcenpay_verify_commitment",
      "arcenpay_dispute_claim",
      "arcenpay_settlement_status",
    ]);

    for (const tool of ARCENPAY_MCP_TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });

  it("should handle arcenpay_resolve_payment_link", async () => {
    const mcp = createArcenAgentMcpTools(agent);
    vi.spyOn(agent, "resolvePaymentLink").mockResolvedValue(MOCK_SPEC);

    // Missing arg
    const errorRes = await mcp.handleToolCall("arcenpay_resolve_payment_link", {});
    expect(errorRes.isError).toBe(true);

    // Success
    const res = await mcp.handleToolCall("arcenpay_resolve_payment_link", {
      urlOrSlug: "pl_test_123",
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.id).toBe("pl_test_123");
  });

  it("should handle arcenpay_pay_payment_link", async () => {
    const mcp = createArcenAgentMcpTools(agent);
    vi.spyOn(agent, "payPaymentLink").mockResolvedValue(MOCK_RECEIPT);

    // Missing arg
    const errorRes = await mcp.handleToolCall("arcenpay_pay_payment_link", {});
    expect(errorRes.isError).toBe(true);

    // Success
    const res = await mcp.handleToolCall("arcenpay_pay_payment_link", {
      urlOrSlug: "pl_test_123",
      maxPrice: "5.00",
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.txHash).toBe(MOCK_RECEIPT.txHash);
  });

  it("should handle arcenpay_create_payment_link", async () => {
    const mcp = createArcenAgentMcpTools(agent);
    vi.spyOn(agent, "createPaymentLink").mockResolvedValue(MOCK_SPEC);

    // Missing/invalid args
    const errorRes = await mcp.handleToolCall("arcenpay_create_payment_link", {
      title: "",
      amount: -5,
    });
    expect(errorRes.isError).toBe(true);

    // Success
    const res = await mcp.handleToolCall("arcenpay_create_payment_link", {
      title: "Custom LLM Query",
      amount: 1.5,
      currency: "USDC",
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.id).toBe("pl_test_123");
  });

  it("should handle arcenpay_get_spend_summary", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    const res = await mcp.handleToolCall("arcenpay_get_spend_summary", {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toHaveProperty("dailySpent");
    expect(parsed).toHaveProperty("totalSpent");
  });

  it("should handle arcenpay_check_balance", async () => {
    const mcp = createArcenAgentMcpTools(agent);
    vi.spyOn(agent, "getBalance").mockResolvedValue(12_500_000n);

    const res = await mcp.handleToolCall("arcenpay_check_balance", {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.balanceAtomic).toBe("12500000");
    expect(parsed.balanceUsdc).toBe("12.500000");
    expect(parsed.address).toBe(agent.address);
  });

  it("should handle arcenpay_fund_session", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing amount
    const errorRes = await mcp.handleToolCall("arcenpay_fund_session", {});
    expect(errorRes.isError).toBe(true);

    vi.spyOn(agent, "fundSession").mockResolvedValue("sess_funded_1");

    const res = await mcp.handleToolCall("arcenpay_fund_session", { amount: "5.00" });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.sessionId).toBe("sess_funded_1");
    expect(parsed.fundedAmountUsdc).toBe("5.00");
  });

  it("should handle arcenpay_fetch", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing url
    const errorRes = await mcp.handleToolCall("arcenpay_fetch", {});
    expect(errorRes.isError).toBe(true);

    vi.spyOn(agent, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await mcp.handleToolCall("arcenpay_fetch", {
      url: "https://api.example.com/data",
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe(200);
    expect(parsed.ok).toBe(true);
    expect(parsed.body.ok).toBe(true);
  });

  it("should handle arcenpay_issue_mandate", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing required args
    const errorRes = await mcp.handleToolCall("arcenpay_issue_mandate", {});
    expect(errorRes.isError).toBe(true);

    const mockMandate: ArcenPayAgentMandate = {
      type: "ArcenPayAgentMandate",
      version: "1.0",
      mandateId: "mandate_123",
      issuer: { kind: "parent_agent", address: agent.address, chainId: 8453 },
      subject: { kind: "agent", agentId: "worker-1", publicKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
      scope: {
        maxPerTxn: "0.50",
        maxDaily: "5.00",
        allowedTokens: ["USDC"],
        validFrom: new Date(1725600000000).toISOString(),
        validUntil: new Date(1725686400000).toISOString(),
      },
      signature: "0xmocksignature",
      issuedAt: new Date().toISOString(),
    };

    vi.spyOn(agent, "issueMandate").mockResolvedValue(mockMandate);

    const res = await mcp.handleToolCall("arcenpay_issue_mandate", {
      childAgentId: "worker-1",
      childPublicKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      maxPerTxn: "0.50",
      maxDaily: "5.00",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.mandateId).toBe("mandate_123");
  });

  it("should handle arcenpay_check_policy", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    agent.addPolicy({
      policyId: "allow-all-small",
      name: "Allow Small Transactions",
      effect: "EFFECT_ALLOW",
      condition: "tx.amount <= 1.00",
      priority: 100,
    });

    const res = await mcp.handleToolCall("arcenpay_check_policy", {
      amount: "0.50",
      token: "USDC",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.outcome).toBe("OUTCOME_ALLOW");
  });

  it("should handle arcenpay_revoke_mandate", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing mandateId
    const errorRes = await mcp.handleToolCall("arcenpay_revoke_mandate", {});
    expect(errorRes.isError).toBe(true);

    vi.spyOn(agent, "revokeMandate").mockResolvedValue({
      success: true,
      txHash: "0xrevoketxhash",
    });

    const res = await mcp.handleToolCall("arcenpay_revoke_mandate", {
      mandateId: "mandate_123",
      reason: "security_rotation",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.txHash).toBe("0xrevoketxhash");
  });

  it("should handle arcenpay_mandate_status", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    vi.spyOn(agent, "getMandateStatus").mockResolvedValue("active");

    const res = await mcp.handleToolCall("arcenpay_mandate_status", {
      mandateId: "mandate_123",
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("active");
  });

  it("should handle arcenpay_fetch_escrowed", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing url
    const errorRes = await mcp.handleToolCall("arcenpay_fetch_escrowed", {});
    expect(errorRes.isError).toBe(true);

    vi.spyOn(agent, "fetchEscrowed").mockResolvedValue({
      verified: true,
      payload: { data: "market-alpha" },
      commitment: {
        reservationId: "res_123",
        mode: "exact_hash",
        commitment: "sha256:12345",
        providerAddress: "0xProvider...",
        timestamp: 1725600000,
        challengeWindowSeconds: 300,
      },
    } as any);

    const res = await mcp.handleToolCall("arcenpay_fetch_escrowed", {
      url: "https://provider.arcenpay.xyz/data",
      mode: "exact_hash",
      maxPrice: "5.00",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.verified).toBe(true);
    expect(parsed.payload.data).toBe("market-alpha");
  });

  it("should handle arcenpay_verify_commitment", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing commitment
    const errorRes = await mcp.handleToolCall("arcenpay_verify_commitment", {});
    expect(errorRes.isError).toBe(true);

    const commitment: ProviderCommitment = {
      reservationId: "res_123",
      mode: "schema_conformance",
      commitment: "schema-hash-123",
      providerAddress: "0xProvider...",
      timestamp: Math.floor(Date.now() / 1000),
      challengeWindowSeconds: 300,
    };

    const res = await mcp.handleToolCall("arcenpay_verify_commitment", {
      commitment,
      payload: { result: "ok" },
      schemaDescriptor: { required: ["result"] },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.valid).toBe(true);
  });

  it("should handle arcenpay_dispute_claim", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing args
    const errorRes = await mcp.handleToolCall("arcenpay_dispute_claim", {});
    expect(errorRes.isError).toBe(true);

    const mockDispute: DisputeReceipt = {
      type: "ArcenDisputeReceipt",
      requestNonce: "nonce_123",
      outcome: "refunded",
      reason: "corrupted_payload",
      refundedAmount: "5.00",
      resolvedAt: new Date().toISOString(),
    };

    vi.spyOn(agent, "disputeSettlement").mockResolvedValue(mockDispute);

    const res = await mcp.handleToolCall("arcenpay_dispute_claim", {
      requestNonce: "nonce_123",
      failureReason: "schema_violation",
      schemaViolationDetail: "hash mismatch",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.requestNonce).toBe("nonce_123");
    expect(parsed.outcome).toBe("refunded");
  });

  it("should handle arcenpay_settlement_status", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    // Missing nonce
    const errorRes = await mcp.handleToolCall("arcenpay_settlement_status", {});
    expect(errorRes.isError).toBe(true);

    vi.spyOn(agent, "getSettlementStatus").mockResolvedValue({
      id: "esc_123",
      requestNonce: "nonce_123",
      sessionId: "sess_123",
      payerWallet: agent.address,
      recipientWallet: "0xProvider...",
      amount: "5.000000",
      amountAtomic: "5000000",
      tokenAddress: "0xUSDC",
      chainId: 8453,
      mode: "exact_hash",
      status: "released",
      challengeWindowSeconds: 300,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await mcp.handleToolCall("arcenpay_settlement_status", {
      requestNonce: "nonce_123",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe("released");
  });

  it("should reject unknown tool calls gracefully", async () => {
    const mcp = createArcenAgentMcpTools(agent);

    const res = await mcp.handleToolCall("arcenpay_nonexistent_tool", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown MCP tool");
  });

  it("should catch unexpected tool execution errors gracefully", async () => {
    const mcp = createArcenAgentMcpTools(agent);
    vi.spyOn(agent, "resolvePaymentLink").mockRejectedValue(
      new Error("Network connection dropped")
    );

    const res = await mcp.handleToolCall("arcenpay_resolve_payment_link", {
      urlOrSlug: "pl_err",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Network connection dropped");
  });
});
