import { Hono } from "hono";
import { MCP_DOMAIN_CHALLENGE_TOKEN } from "../config.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./oauth.js";

/**
 * OpenAI plugin-submission + OAuth discovery endpoints.
 *
 *  - `/.well-known/openai-apps-challenge` — the domain-verification token,
 *    served verbatim as plain text.
 *  - `/.well-known/oauth-protected-resource` — protected-resource metadata.
 *  - `/.well-known/oauth-authorization-server` — authorization-server metadata.
 *
 * Factored as a factory so the token source is injectable in tests.
 */
export function createMcpWellKnownRoutes(
  getChallengeToken: () => string = () => MCP_DOMAIN_CHALLENGE_TOKEN,
): Hono {
  return new Hono()
    .get("/openai-apps-challenge", (c) => {
      const token = getChallengeToken();
      if (!token) {
        return c.text("Not configured", 404 as any);
      }
      return c.text(token, 200 as any, {
        "content-type": "text/plain; charset=utf-8",
      });
    })
    .get("/oauth-protected-resource", (c) => {
      const metadata = protectedResourceMetadata();
      if (!metadata.resource) {
        return c.json({ error: "MCP resource URL not configured" }, 404 as any);
      }
      return c.json(metadata);
    })
    .get("/oauth-authorization-server", (c) => {
      const metadata = authorizationServerMetadata();
      if (!metadata.issuer) {
        return c.json({ error: "OAuth issuer not configured" }, 404 as any);
      }
      return c.json(metadata);
    });
}

export const mcpWellKnownRoutes = createMcpWellKnownRoutes();
