#!/usr/bin/env node
// ============================================================
//  @arcenpay/agent — Local (stdio) MCP server
//  Exposes the ArcenPay agent toolset to MCP hosts:
//  Claude Desktop, Claude Code, Cursor, Codex, and any MCP client.
//
//  Run via the `arcenpay-mcp` bin, or wire it into a host config:
//    { "command": "npx", "args": ["-y", "-p", "@arcenpay/agent", "arcenpay-mcp"] }
// ============================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ArcenAgent } from "./agent";
import { createArcenAgentMcpTools } from "./mcp-tools";
import { FileStore } from "./store";

const DEFAULT_CHAIN_ID = 84532;

/**
 * Builds an ArcenAgent from environment variables. Never logs or serializes
 * the private key — it is only passed straight into the agent.
 */
export function buildAgentFromEnv(env: NodeJS.ProcessEnv = process.env): ArcenAgent {
  const privateKey = env.AGENT_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error(
      "AGENT_PRIVATE_KEY is required (EVM hex, Stellar secret key, or Solana base58/JSON secret).",
    );
  }

  const chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : DEFAULT_CHAIN_ID;
  if (!Number.isFinite(chainId)) {
    throw new Error(`CHAIN_ID must be a number, received '${env.CHAIN_ID}'.`);
  }

  return new ArcenAgent({
    privateKey,
    chainId,
    rpcUrl: env.RPC_URL || undefined,
    apiUrl: env.ARCENPAY_API_URL || undefined,
    apiKey: env.ARCENPAY_API_KEY || undefined,
    maxAutoApprove: env.MAX_AUTO_APPROVE || undefined,
    maxDailySpend: env.MAX_DAILY_SPEND || undefined,
    sessionVaultAddress: env.SESSION_VAULT_ADDRESS || undefined,
    horizonUrl: env.HORIZON_URL || undefined,
    sorobanRpcUrl: env.SOROBAN_RPC_URL || undefined,
    networkPassphrase: env.NETWORK_PASSPHRASE || undefined,
    store: env.AGENT_STORE_PATH ? new FileStore(env.AGENT_STORE_PATH) : undefined,
  });
}

/** Wraps the ArcenPay agent toolset in an MCP Server (no transport attached yet). */
export function createArcenPayMcpServer(agent: ArcenAgent): Server {
  const mcp = createArcenAgentMcpTools(agent);

  const server = new Server(
    { name: "arcenpay", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "ArcenPay lets this agent discover and pay for x402-gated APIs and agentic payment links, " +
        "within configured budget limits. Call arcenpay_check_balance or arcenpay_get_spend_summary " +
        "before spending. arcenpay_pay_payment_link and arcenpay_fund_session move funds and are " +
        "irreversible — confirm the amount with the user before calling them.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcp.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await mcp.handleToolCall(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
    );
    return {
      content: result.content,
      isError: result.isError,
    };
  });

  return server;
}

/** Boots the stdio MCP server (used by the `arcenpay-mcp` bin). */
export async function main(): Promise<void> {
  const agent = buildAgentFromEnv();
  await agent.restore();
  const server = createArcenPayMcpServer(agent);
  await server.connect(new StdioServerTransport());
}

const entrypoint = process.argv[1] ?? "";
if (/mcp-server(\.[cm]?js)?$/.test(entrypoint)) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[arcenpay-mcp] fatal: ${message}`);
    process.exit(1);
  });
}
