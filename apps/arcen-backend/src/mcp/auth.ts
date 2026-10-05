import {
  requireApiKey,
  isApiKeyError,
  type ApiKeyContext,
  type ApiKeyError,
} from "../lib/auth/api-key-auth.js";
import { extractMcpBearer, parseScope, verifyMcpAccessToken } from "./oauth.js";

export type McpAuthResolution =
  | { ok: true; auth: ApiKeyContext }
  | { ok: false; error: ApiKeyError };

/**
 * Resolves the MCP caller. Two principals are accepted:
 *
 *  1. A hosted OAuth 2.1 access token (issued by `/oauth/token`). This is what
 *     ChatGPT connectors use, since ChatGPT cannot send a static API key.
 *  2. An ArcenPay SECRET/RESTRICTED API key (`Authorization: Bearer sk_/rk_…`),
 *     used by Claude/Cursor/Codex and server-to-server clients.
 *
 * Publishable keys are rejected: every MCP tool reads tenant data. All API-key
 * validation (revocation, expiry, permissions, rate limiting) is delegated to
 * `requireApiKey`; OAuth tokens are verified locally.
 */
export async function resolveMcpAuth(
  request: Request,
): Promise<McpAuthResolution> {
  const bearer = extractMcpBearer(request);
  if (bearer) {
    const claims = verifyMcpAccessToken(bearer);
    if (claims) {
      return {
        ok: true,
        auth: {
          teamId: claims.teamId,
          apiKeyId: `oauth:${claims.sub}`,
          environmentId: claims.environmentId ?? null,
          keyType: "SECRET",
          permissions: parseScope(claims.scope),
          environmentMode: null,
        },
      };
    }
  }

  const result = await requireApiKey(request, {
    allow: ["SECRET", "RESTRICTED"],
  });
  if (isApiKeyError(result)) {
    return { ok: false, error: result };
  }
  return { ok: true, auth: result };
}
