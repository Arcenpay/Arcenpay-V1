import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpAuth } from "./auth.js";
import { createDefaultMcpDeps, type McpDeps } from "./deps.js";
import { registerReadOnlyTools } from "./tools.js";
import type { ApiKeyContext } from "../lib/auth/api-key-auth.js";
import { MCP_OAUTH_ISSUER } from "../config.js";

export const MCP_SERVER_NAME = "arcenpay";
export const MCP_SERVER_VERSION = "1.0.0";

/** Builds a fresh McpServer bound to one authenticated context + deps. */
export function createArcenMcpServer(
  ctx: ApiKeyContext,
  deps: McpDeps,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Read-only ArcenPay account tools. They never move funds or change state. " +
        "Call get_account first to confirm the workspace, then list_companies or " +
        "list_payment_links to inspect it.",
    },
  );
  registerReadOnlyTools(server, ctx, deps);
  return server;
}

/**
 * Handles a single MCP request over the Streamable HTTP transport.
 *
 * Stateless mode (no session id): a fresh transport + server is created per
 * request, which keeps the surface simple and horizontal-scalable. Auth is
 * resolved from the ArcenPay credential before any tool is reachable.
 */
export async function handleMcpRequest(
  request: Request,
  deps: McpDeps = createDefaultMcpDeps(),
): Promise<Response> {
  const resolution = await resolveMcpAuth(request);
  if (!resolution.ok) {
    const resourceMetadataUrl = MCP_OAUTH_ISSUER
      ? `${MCP_OAUTH_ISSUER.replace(/\/+$/, "")}/.well-known/oauth-protected-resource`
      : null;
    const challenge = resourceMetadataUrl
      ? `Bearer realm="arcenpay-mcp", resource_metadata="${resourceMetadataUrl}"`
      : 'Bearer realm="arcenpay-mcp"';
    return new Response(
      JSON.stringify({
        ok: false,
        error: resolution.error.error,
        code: "UNAUTHORIZED",
      }),
      {
        status: resolution.error.status,
        headers: {
          "content-type": "application/json",
          "www-authenticate": challenge,
        },
      },
    );
  }

  const server = createArcenMcpServer(resolution.auth, deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
