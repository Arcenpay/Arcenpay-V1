// ============================================================
//  @arcenpay/agent — Framework Adapters Tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcenAgent, resolveEvmChain } from "../src/agent";
import {
  createArcenAgentLangChainTools,
  toLangChainTools,
  createArcenAgentVercelAITools,
  toVercelTools,
  createArcenAgentOpenAITools,
  toOpenAITools,
  executeOpenAITool,
  createArcenAgentAnthropicTools,
  toAnthropicTools,
  executeAnthropicTool,
  executeArcenAgentTool,
  ARCENPAY_AGENT_TOOL_SCHEMAS,
} from "../src/frameworks";
import { createArcenAgentMcpTools } from "../src/mcp-tools";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("Multi-Framework AI Adapters", () => {
  let agent: ArcenAgent;

  beforeEach(() => {
    agent = new ArcenAgent({
      privateKey: TEST_PRIVATE_KEY,
      chainId: 11155111,
      rpcUrl: "http://localhost:8545",
      sessionId: "0x" + "11".repeat(32),
    });
  });

  describe("resolveEvmChain", () => {
    it("resolves known chains from CHAIN_MAP", () => {
      const sepoliaChain = resolveEvmChain(11155111);
      expect(sepoliaChain.id).toBe(11155111);

      const baseChain = resolveEvmChain(8453);
      expect(baseChain.id).toBe(8453);
    });

    it("dynamically defines an EVM chain for custom chain ID without falling back to Sepolia", () => {
      const polygonChain = resolveEvmChain(137, "https://polygon-rpc.com");
      expect(polygonChain.id).toBe(137);
      expect(polygonChain.name).toBeDefined();
      expect(polygonChain.rpcUrls.default.http[0]).toBe("https://polygon-rpc.com");
    });
  });

  describe("executeArcenAgentTool core dispatcher", () => {
    it("handles arcenpay_check_balance", async () => {
      vi.spyOn(agent, "getBalance").mockResolvedValue(5_000_000n);

      const result = await executeArcenAgentTool(agent, "arcenpay_check_balance", {});
      expect(result.balanceAtomic).toBe("5000000");
      expect(result.balanceUsdc).toBe("5");
      expect(result.address).toBe(agent.address);
      expect(result.isStellar).toBe(false);
    });

    it("handles arcenpay_fund_session", async () => {
      vi.spyOn(agent, "fundSession").mockResolvedValue("0xsession123");

      const result = await executeArcenAgentTool(agent, "arcenpay_fund_session", {
        amount: "10.00",
      });
      expect(result.sessionId).toBe("0xsession123");
      expect(result.fundedAmountUsdc).toBe("10.00");
    });

    it("handles arcenpay_resolve_payment_link", async () => {
      vi.spyOn(agent, "resolvePaymentLink").mockResolvedValue({
        id: "link_123",
        slug: "coffee",
        title: "Buy Coffee",
        amount: 3.5,
        currency: "USDC",
        chainId: 8453,
        status: "ACTIVE",
        recipientWallet: "0xrecipient",
      } as any);

      const result = await executeArcenAgentTool(
        agent,
        "arcenpay_resolve_payment_link",
        { urlOrSlug: "coffee" },
      );
      expect(result.title).toBe("Buy Coffee");
      expect(result.amount).toBe(3.5);
    });

    it("handles arcenpay_get_spend_summary", async () => {
      const result = await executeArcenAgentTool(
        agent,
        "arcenpay_get_spend_summary",
        {},
      );
      expect(result).toHaveProperty("dailySpent");
      expect(result).toHaveProperty("totalSpent");
    });

    it("throws on unknown tool", async () => {
      await expect(
        executeArcenAgentTool(agent, "non_existent_tool", {}),
      ).rejects.toThrow("Unknown ArcenPay tool");
    });
  });

  describe("LangChain Adapter", () => {
    it("creates LangChain-compatible tools", async () => {
      const tools = toLangChainTools(agent);
      expect(tools.length).toBe(ARCENPAY_AGENT_TOOL_SCHEMAS.length);

      const checkBalanceTool = tools.find((t) => t.name === "arcenpay_check_balance");
      expect(checkBalanceTool).toBeDefined();
      expect(typeof checkBalanceTool?.invoke).toBe("function");
      expect(typeof checkBalanceTool?.call).toBe("function");

      vi.spyOn(agent, "getBalance").mockResolvedValue(2_000_000n);
      const res = await checkBalanceTool!.invoke({});
      const parsed = JSON.parse(res);
      expect(parsed.balanceAtomic).toBe("2000000");
      expect(parsed.balanceUsdc).toBe("2");
    });
  });

  describe("Vercel AI SDK Adapter", () => {
    it("creates Vercel AI SDK tool dictionary", async () => {
      const tools = toVercelTools(agent);
      expect(tools.arcenpay_check_balance).toBeDefined();
      expect(tools.arcenpay_fund_session).toBeDefined();
      expect(tools.arcenpay_resolve_payment_link).toBeDefined();
      expect(tools.arcenpay_pay_payment_link).toBeDefined();
      expect(tools.arcenpay_create_payment_link).toBeDefined();
      expect(tools.arcenpay_fetch).toBeDefined();
      expect(tools.arcenpay_get_spend_summary).toBeDefined();

      vi.spyOn(agent, "getBalance").mockResolvedValue(7_500_000n);
      const res = await tools.arcenpay_check_balance.execute({});
      expect(res.balanceAtomic).toBe("7500000");
      expect(res.balanceUsdc).toBe("7.5");
    });
  });

  describe("OpenAI Tools Adapter", () => {
    it("generates OpenAI function tool definitions", () => {
      const tools = toOpenAITools();
      expect(tools.length).toBe(ARCENPAY_AGENT_TOOL_SCHEMAS.length);
      for (const tool of tools) {
        expect(tool.type).toBe("function");
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters.type).toBe("object");
      }
    });

    it("executes OpenAI tool calls with JSON string arguments", async () => {
      vi.spyOn(agent, "fundSession").mockResolvedValue("0xsession999");
      const res = await executeOpenAITool(
        agent,
        "arcenpay_fund_session",
        JSON.stringify({ amount: "25.00" }),
      );
      expect(res.sessionId).toBe("0xsession999");
      expect(res.fundedAmountUsdc).toBe("25.00");
    });
  });

  describe("Anthropic Claude Tools Adapter", () => {
    it("generates Anthropic Claude tool definitions", () => {
      const tools = toAnthropicTools();
      expect(tools.length).toBe(ARCENPAY_AGENT_TOOL_SCHEMAS.length);
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.input_schema.type).toBe("object");
      }
    });

    it("executes Anthropic tool use blocks with record input", async () => {
      vi.spyOn(agent, "getBalance").mockResolvedValue(1_000_000n);
      const res = await executeAnthropicTool(agent, "arcenpay_check_balance", {});
      expect(res.balanceAtomic).toBe("1000000");
      expect(res.balanceUsdc).toBe("1");
    });
  });

  describe("MCP Tools integration", () => {
    it("supports MCP tool definitions and execution dispatcher", async () => {
      const mcp = createArcenAgentMcpTools(agent);
      expect(mcp.tools).toHaveLength(12);

      const response = await mcp.handleToolCall("arcenpay_get_spend_summary", {});
      expect(response.isError).toBeFalsy();
      const data = JSON.parse(response.content[0].text);
      expect(data).toHaveProperty("dailySpent");
      expect(data).toHaveProperty("totalSpent");
    });
  });
});
