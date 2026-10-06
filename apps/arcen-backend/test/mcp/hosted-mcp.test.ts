import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createArcenMcpServer, handleMcpRequest } from "../../src/mcp/server.js";
import { createDefaultMcpDeps, type McpDeps } from "../../src/mcp/deps.js";
import type { ApiKeyContext } from "../../src/lib/auth/api-key-auth.js";

const CTX: ApiKeyContext = {
  teamId: "team_1",
  apiKeyId: "key_1",
  environmentId: "env_1",
  keyType: "SECRET",
  permissions: ["entitlements.read", "invoices.read"],
  environmentMode: "DEVELOPMENT",
};

const EXPECTED_TOOLS = [
  "get_account",
  "list_companies",
  "get_company",
  "list_payment_links",
  "get_payment_link_spec",
  "get_mandate_status",
  "get_settlement_status",
  "list_plans",
  "list_addons",
  "get_subscription",
  "check_entitlement",
  "list_invoices",
  "get_invoice",
  "get_invoice_download_url",
  "list_chains",
];

function fakeDeps(): McpDeps {
  return {
    listCompanies: vi.fn(async () => ({
      items: [{ id: "cmp_1", name: "Acme" }],
      count: 1,
    })),
    getCompany: vi.fn(async (_ctx, id) =>
      id === "cmp_1" ? { id, name: "Acme" } : null,
    ),
    listPaymentLinks: vi.fn(async () => [
      { id: "pl_1", slug: "demo", amount: "5.000000" },
    ]),
    getPaymentLinkSpec: vi.fn(async (_ctx, slug) =>
      slug === "demo" ? { type: "agentic_payment_link", slug } : null,
    ),
    listPlans: vi.fn(async () => [
      { id: "plan_1", name: "Pro", price: "29.000000" },
    ]),
    listAddons: vi.fn(async () => [
      { id: "addon_1", code: "seats", price: "5.000000" },
    ]),
    getSubscription: vi.fn(async (_ctx, companyId) =>
      companyId === "cmp_1"
        ? { companyId, subscription: { status: "ACTIVE" } }
        : null,
    ),
    checkEntitlement: vi.fn(async (_ctx, companyId, featureKey) =>
      companyId === "cmp_1" ? { key: featureKey, enabled: true } : null,
    ),
    listInvoices: vi.fn(async () => [
      { id: "inv_1", number: "INV-1", status: "PAID", total: "29.000000" },
    ]),
    getInvoice: vi.fn(async (_ctx, id) =>
      id === "inv_1" ? { id, number: "INV-1" } : null,
    ),
    getInvoiceDownloadUrl: vi.fn(async (_ctx, id) =>
      id === "inv_1"
        ? "https://app.arcenpay.com/api/invoices/public/inv_1/download?kind=invoice"
        : null,
    ),
    listChains: vi.fn(async () => [
      { chainId: 84532, name: "Base Sepolia", testnet: true, family: "evm" },
    ]),
    getMandateStatus: vi.fn(() => ({ mandateId: "m_1", status: "active" })),
    getSettlementStatus: vi.fn(() => ({
      requestNonce: "n_1",
      status: "released",
    })),
  };
}

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content?.[0] as { text?: string } | undefined;
  return block?.text ?? "";
}

describe("hosted MCP read-only tools", () => {
  it("advertises the full read-only tool set with read-only annotations", async () => {
    const server = createArcenMcpServer(CTX, fakeDeps());
    const client = await connect(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }

    await client.close();
  });

  it("get_account returns the authenticated context", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));
    const result = await client.callTool({ name: "get_account", arguments: {} });
    const data = JSON.parse(text(result));
    expect(data.teamId).toBe("team_1");
    expect(data.environmentId).toBe("env_1");
    expect(data.keyType).toBe("SECRET");
    await client.close();
  });

  it("list_companies delegates to deps and returns items", async () => {
    const deps = fakeDeps();
    const client = await connect(createArcenMcpServer(CTX, deps));
    const result = await client.callTool({
      name: "list_companies",
      arguments: { limit: 10 },
    });
    const data = JSON.parse(text(result));
    expect(data.items[0].id).toBe("cmp_1");
    expect(deps.listCompanies).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("get_company reports a missing company as an error result", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));
    const result = await client.callTool({
      name: "get_company",
      arguments: { id: "missing" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("get_payment_link_spec returns the spec for a known slug", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));
    const result = await client.callTool({
      name: "get_payment_link_spec",
      arguments: { slug: "demo" },
    });
    const data = JSON.parse(text(result));
    expect(data.type).toBe("agentic_payment_link");
    await client.close();
  });

  it("get_mandate_status and get_settlement_status proxy the services", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));

    const mandate = await client.callTool({
      name: "get_mandate_status",
      arguments: { mandateId: "m_1" },
    });
    expect(JSON.parse(text(mandate)).status).toBe("active");

    const settlement = await client.callTool({
      name: "get_settlement_status",
      arguments: { requestNonce: "n_1" },
    });
    expect(JSON.parse(text(settlement)).status).toBe("released");

    await client.close();
  });

  it("list_plans / list_addons / list_chains return discovery data", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));

    const plans = await client.callTool({ name: "list_plans", arguments: {} });
    expect(JSON.parse(text(plans))[0].name).toBe("Pro");

    const addons = await client.callTool({ name: "list_addons", arguments: {} });
    expect(JSON.parse(text(addons))[0].code).toBe("seats");

    const chains = await client.callTool({ name: "list_chains", arguments: {} });
    expect(JSON.parse(text(chains))[0].chainId).toBe(84532);

    await client.close();
  });

  it("default deps listChains supports all chain families without throwing", async () => {
    const deps = createDefaultMcpDeps();
    const chains = (await deps.listChains()) as Array<{
      chainId: number;
      name: string;
      testnet: boolean;
      family: string;
      contracts: Record<string, string> | null;
    }>;
    expect(chains.length).toBeGreaterThan(0);
    const stellarChain = chains.find((c) => c.chainId === 9000000);
    expect(stellarChain).toBeDefined();
    expect(stellarChain?.family).toBe("stellar");
    expect(stellarChain?.name).toBe("Stellar Mainnet");

    const evmChain = chains.find((c) => c.chainId === 84532);
    expect(evmChain).toBeDefined();
    expect(evmChain?.family).toBe("evm");
  });

  it("get_subscription and check_entitlement scope to a company", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));

    const sub = await client.callTool({
      name: "get_subscription",
      arguments: { companyId: "cmp_1" },
    });
    expect(JSON.parse(text(sub)).subscription.status).toBe("ACTIVE");

    const ent = await client.callTool({
      name: "check_entitlement",
      arguments: { companyId: "cmp_1", featureKey: "api_calls" },
    });
    expect(JSON.parse(text(ent)).enabled).toBe(true);

    const missing = await client.callTool({
      name: "check_entitlement",
      arguments: { companyId: "nope", featureKey: "api_calls" },
    });
    expect(missing.isError).toBe(true);

    await client.close();
  });

  it("invoice tools list, fetch, and mint a download URL", async () => {
    const client = await connect(createArcenMcpServer(CTX, fakeDeps()));

    const list = await client.callTool({ name: "list_invoices", arguments: {} });
    expect(JSON.parse(text(list))[0].number).toBe("INV-1");

    const one = await client.callTool({
      name: "get_invoice",
      arguments: { id: "inv_1" },
    });
    expect(JSON.parse(text(one)).id).toBe("inv_1");

    const url = await client.callTool({
      name: "get_invoice_download_url",
      arguments: { id: "inv_1" },
    });
    expect(JSON.parse(text(url)).url).toContain("/download?kind=invoice");

    await client.close();
  });
});

describe("hosted MCP transport auth", () => {
  it("returns 401 + WWW-Authenticate when no credential is present", async () => {
    const request = new Request("https://api.arcenpay.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });

    const response = await handleMcpRequest(request, {} as McpDeps);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("returns 401 for a non-ArcenPay bearer token", async () => {
    const request = new Request("https://api.arcenpay.com/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer not-an-arcenpay-key",
        "content-type": "application/json",
      },
      body: "{}",
    });

    const response = await handleMcpRequest(request, {} as McpDeps);
    expect(response.status).toBe(401);
  });
});
