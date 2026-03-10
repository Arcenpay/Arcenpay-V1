/**
 * Playwright route intercepts for contract reads, subgraph queries, and
 * facilitator API calls.
 *
 * Call `setupMockRoutes(page)` in `test.beforeEach` to prevent tests from
 * hitting live chains or external services in CI.
 *
 * Mocked surfaces:
 *  1. Ethereum JSON-RPC (eth_call, eth_chainId, eth_blockNumber, eth_getBalance)
 *  2. The Graph subgraph (GraphQL POST)
 *  3. Facilitator REST API (http://localhost:3402 or PLAYWRIGHT_FACILITATOR_URL)
 */

import type { Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ABI-encode a uint256 value as a 32-byte padded hex string (no 0x). */
function encodeUint256(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

/** ABI-encode a bool as a 32-byte padded hex string. */
function encodeBool(v: boolean): string {
  return encodeUint256(v ? 1n : 0n);
}

/** ABI-encode an address as a 32-byte padded hex string. */
function encodeAddress(addr: string): string {
  return addr.replace("0x", "").padStart(64, "0");
}

const ZERO_UINT = `0x${encodeUint256(0n)}`;
const ZERO_BOOL = `0x${encodeBool(false)}`;
const ZERO_ADDRESS = `0x${encodeAddress("0x0000000000000000000000000000000000000000")}`;

// ── 1. Ethereum JSON-RPC mock ─────────────────────────────────────────────────

const RPC_URL_PATTERNS = [
  "**/rpc.sepolia.org/**",
  "**/publicnode.com/**",
  "**/infura.io/**",
  "**/alchemy.com/**",
  "**/cloudflare-eth.com/**",
  "**/sepolia.base.org/**",
  "**/mainnet.base.org/**",
  // Generic catch-all for any JSON-RPC POST that returns eth_* methods
  "**/eth_call*",
];

function rpcResultFor(method: string, params?: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0xaa36a7"; // Sepolia (11155111)
    case "eth_blockNumber":
      return "0x12D687"; // arbitrary block
    case "eth_getBalance":
      return "0x0";
    case "eth_call":
      // Return zero-value for any contract read — components handle 0 / undefined gracefully
      return ZERO_UINT;
    case "eth_gasPrice":
    case "eth_maxFeePerGas":
    case "eth_maxPriorityFeePerGas":
      return "0x3B9ACA00"; // 1 gwei
    case "net_version":
      return "11155111";
    default:
      return null;
  }
}

async function mockRpcEndpoint(page: Page, urlPattern: string): Promise<void> {
  await page.route(urlPattern, async (route) => {
    const request = route.request();
    let body: unknown;
    try {
      body = JSON.parse(request.postData() ?? "{}");
    } catch {
      body = {};
    }

    // Handle both single requests and batch arrays
    const isBatch = Array.isArray(body);
    const requests = isBatch ? (body as { id: unknown; method: string; params?: unknown[] }[]) : [body as { id: unknown; method: string; params?: unknown[] }];
    const responses = requests.map(({ id, method, params }) => ({
      jsonrpc: "2.0",
      id,
      result: rpcResultFor(method, params),
    }));

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isBatch ? responses : responses[0]),
    });
  });
}

// ── 2. The Graph subgraph mock ────────────────────────────────────────────────

const SUBGRAPH_PATTERNS = [
  "**/thegraph.com/**",
  "**/graph-node/**",
  "**/subgraphs/**",
];

const MOCK_SUBGRAPH_RESPONSE: Record<string, unknown> = {
  data: {
    protocolStats: {
      id: "1",
      totalSubscriptions: "0",
      totalRevenue: "0",
      activePlans: "0",
    },
    plans: [],
    subscriptions: [],
    sessions: [],
    proofSubmissions: [],
    auditEvents: [],
    invoices: [],
  },
};

async function mockSubgraphEndpoint(page: Page, urlPattern: string): Promise<void> {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SUBGRAPH_RESPONSE),
    });
  });
}

// ── 3. Facilitator API mock ───────────────────────────────────────────────────

const FACILITATOR_BASE =
  process.env.PLAYWRIGHT_FACILITATOR_URL ?? "http://localhost:3402";

const FACILITATOR_MOCK_RESPONSES: Record<string, unknown> = {
  "/api/health": { status: "ok", version: "test" },
  "/api/ops/proof/runtime": { available: false, mode: "dev" },
  "/api/sessions": { sessions: [], total: 0 },
  "/api/usage": { sessions: [], total: 0 },
  "/api/invoices": { invoices: [], total: 0 },
  "/api/audit": { events: [], total: 0 },
};

function getFacilitatorMockBody(path: string): unknown {
  // Exact match first
  if (FACILITATOR_MOCK_RESPONSES[path] !== undefined) {
    return FACILITATOR_MOCK_RESPONSES[path];
  }
  // Prefix match for parameterised routes
  for (const [prefix, response] of Object.entries(FACILITATOR_MOCK_RESPONSES)) {
    if (path.startsWith(prefix)) return response;
  }
  // Tableland / entitlement endpoints
  if (path.includes("/flags")) {
    return { flags: [], tableExists: false };
  }
  if (path.includes("/entitlements")) {
    return { entitlements: [] };
  }
  if (path.includes("/usage")) {
    return { logs: [], total: 0 };
  }
  if (path.includes("/bootstrap")) {
    return { ok: true };
  }
  // Default empty envelope
  return { data: null, error: null };
}

async function mockFacilitatorApi(page: Page): Promise<void> {
  await page.route(`${FACILITATOR_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const mockBody = getFacilitatorMockBody(url.pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockBody),
    });
  });
}

// ── 4. Next.js API proxy routes to facilitator ───────────────────────────────

// The dashboard proxies some facilitator calls through Next.js API routes.
// These are relative paths — they go to the same Next.js server that's under
// test, so they DON'T need Playwright interception (the real Next.js handler
// runs and may in turn call the facilitator, which IS intercepted above).
// Only intercept the direct browser → facilitator calls.

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Set up all route intercepts for a page.
 * Call this in `test.beforeEach` for specs that interact with contracts,
 * subgraph data, or the facilitator API.
 *
 * @example
 * test.beforeEach(async ({ page }) => {
 *   await setupMockRoutes(page);
 *   await page.goto("/");
 * });
 */
export async function setupMockRoutes(page: Page): Promise<void> {
  // 1. Ethereum JSON-RPC
  for (const pattern of RPC_URL_PATTERNS) {
    await mockRpcEndpoint(page, pattern);
  }

  // 2. The Graph subgraph
  for (const pattern of SUBGRAPH_PATTERNS) {
    await mockSubgraphEndpoint(page, pattern);
  }

  // 3. Facilitator REST API
  await mockFacilitatorApi(page);
}

/**
 * Override a specific facilitator path with a custom response.
 * Must be called AFTER `setupMockRoutes` to take precedence.
 */
export async function mockFacilitatorPath(
  page: Page,
  path: string,
  response: unknown,
  status = 200,
): Promise<void> {
  await page.route(`${FACILITATOR_BASE}${path}`, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

/**
 * Override the subgraph GraphQL response with custom data.
 * Must be called AFTER `setupMockRoutes` to take precedence.
 */
export async function mockSubgraphResponse(
  page: Page,
  data: Record<string, unknown>,
): Promise<void> {
  for (const pattern of SUBGRAPH_PATTERNS) {
    await page.route(pattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    });
  }
}
