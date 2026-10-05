import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ArcenAgent } from "../src/agent";
import { buildAgentFromEnv, createArcenPayMcpServer } from "../src/mcp-server";
import { ARCENPAY_MCP_TOOL_DEFINITIONS } from "../src/mcp-tools";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("ArcenPay stdio MCP server", () => {
  it("buildAgentFromEnv requires AGENT_PRIVATE_KEY", () => {
    expect(() => buildAgentFromEnv({} as NodeJS.ProcessEnv)).toThrow(
      /AGENT_PRIVATE_KEY/,
    );
  });

  it("buildAgentFromEnv defaults to chain 84532 and honors CHAIN_ID", () => {
    const defaultAgent = buildAgentFromEnv({
      AGENT_PRIVATE_KEY: TEST_PRIVATE_KEY,
    } as NodeJS.ProcessEnv);
    expect(defaultAgent.chainId).toBe(84532);
    expect(defaultAgent.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const overrideAgent = buildAgentFromEnv({
      AGENT_PRIVATE_KEY: TEST_PRIVATE_KEY,
      CHAIN_ID: "11155111",
    } as NodeJS.ProcessEnv);
    expect(overrideAgent.chainId).toBe(11155111);
  });

  it("rejects a non-numeric CHAIN_ID", () => {
    expect(() =>
      buildAgentFromEnv({
        AGENT_PRIVATE_KEY: TEST_PRIVATE_KEY,
        CHAIN_ID: "not-a-number",
      } as NodeJS.ProcessEnv),
    ).toThrow(/CHAIN_ID/);
  });

  it("serves the full ArcenPay toolset over MCP", async () => {
    const agent = new ArcenAgent({ privateKey: TEST_PRIVATE_KEY, chainId: 8453 });
    const server = createArcenPayMcpServer(agent);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "arcenpay-test-client", version: "1.0.0" });

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(ARCENPAY_MCP_TOOL_DEFINITIONS.length);
    expect(listed.tools.map((t) => t.name)).toContain(
      "arcenpay_check_balance",
    );

    vi.spyOn(agent, "getSpendSummary").mockReturnValue({
      dailySpent: "0.00",
      totalSpent: "0.00",
      dailyLimit: null,
      autoApproveThreshold: "0.01",
    } as any);

    const result = await client.callTool({
      name: "arcenpay_get_spend_summary",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.content)).toBe(true);

    await client.close();
    await server.close();
  });
});
