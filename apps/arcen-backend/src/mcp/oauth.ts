import { createHash, createHmac, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { getSessionFromCtx } from "../lib/auth/auth.server.js";
import { secureCompare } from "../lib/auth/secure-compare.js";
import { API_PERMISSIONS } from "../lib/auth/api-key-auth.js";
import {
  APP_URL,
  MCP_OAUTH_ISSUER,
  MCP_OAUTH_SECRET,
  MCP_RESOURCE_URL,
} from "../config.js";
import { putEphemeral, takeEphemeral } from "./oauth-store.js";

const CODE_TTL_SECONDS = 60;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const SUPPORTED_SCOPES = [...API_PERMISSIONS];

interface StoredGrant {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  userId: string;
  teamId: string;
  environmentId: string | null;
}

export interface McpAccessClaims {
  iss: string;
  aud?: string;
  sub: string;
  teamId: string;
  environmentId: string | null;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function extractMcpBearer(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function parseScope(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

/** True when `resource` identifies this server (host, or host + /mcp). */
export function resourceMatches(resource: string): boolean {
  if (!resource) return false;
  if (!MCP_RESOURCE_URL) return true;
  const a = resource.replace(/\/+$/, "");
  const b = MCP_RESOURCE_URL.replace(/\/+$/, "");
  return a === b || a === `${b}/mcp` || b === `${a}/mcp`;
}

export function signAccessToken(claims: McpAccessClaims): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", MCP_OAUTH_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyMcpAccessToken(token: string): McpAccessClaims | null {
  if (!MCP_OAUTH_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", MCP_OAUTH_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  if (!secureCompare(signature, expected)) return null;

  let claims: McpAccessClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return null;
  if (!claims.teamId) return null;
  if (claims.aud && !resourceMatches(claims.aud)) return null;
  return claims;
}

export function protectedResourceMetadata() {
  const issuer = MCP_OAUTH_ISSUER || MCP_RESOURCE_URL;
  return {
    resource: MCP_RESOURCE_URL,
    authorization_servers: issuer ? [issuer] : [],
    scopes_supported: SUPPORTED_SCOPES,
    resource_documentation: "https://arcenpay.com/docs/concepts/mcp-server",
  };
}

export function authorizationServerMetadata() {
  const issuer = MCP_OAUTH_ISSUER || MCP_RESOURCE_URL;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
    client_id_metadata_document_supported: true,
  };
}

/**
 * Only allow https redirect URIs (or localhost for dev). When the client
 * identifies itself with a CIMD URL, require the redirect to be same-origin —
 * this stops `/oauth/authorize` being used as an open redirector.
 */
function isAllowedRedirect(clientId: string, redirectUri: string): boolean {
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return false;
  }
  const isHttps = redirect.protocol === "https:";
  const isLocalhost =
    redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1";
  if (!isHttps && !isLocalhost) return false;

  try {
    const client = new URL(clientId);
    if (client.protocol !== "https:") return false;
    return client.origin === redirect.origin;
  } catch {
    return true;
  }
}

function redirectError(
  redirectUri: string,
  error: string,
  description: string,
  state: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

function oauthError(c: Context, error: string, description: string) {
  return c.json({ error, error_description: description }, 400 as any);
}

export function createOAuthRoutes(): Hono {
  const routes = new Hono();

  routes.get("/authorize", async (c: Context) => {
    const url = new URL(c.req.url);
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const responseType = url.searchParams.get("response_type") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const codeChallengeMethod =
      url.searchParams.get("code_challenge_method") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const resource = url.searchParams.get("resource") ?? "";
    const scope = url.searchParams.get("scope") ?? "";

    if (!isAllowedRedirect(clientId, redirectUri)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "invalid client_id or redirect_uri",
        },
        400 as any,
      );
    }
    if (responseType !== "code") {
      return c.redirect(
        redirectError(
          redirectUri,
          "unsupported_response_type",
          "response_type must be code",
          state,
        ),
      );
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      return c.redirect(
        redirectError(
          redirectUri,
          "invalid_request",
          "PKCE with S256 is required",
          state,
        ),
      );
    }
    if (resource && !resourceMatches(resource)) {
      return c.redirect(
        redirectError(
          redirectUri,
          "invalid_target",
          "resource does not match this server",
          state,
        ),
      );
    }

    const session = await getSessionFromCtx(c);
    if (!session) {
      // Hand off to the dashboard's consent screen. The dashboard holds the
      // user's session cookie first-party, so after a one-click "Authorize" it
      // resumes this endpoint same-site (cookie sent) and we issue the code —
      // no repeated full login.
      const consentUrl = `${APP_URL.replace(/\/+$/, "")}/oauth/authorize?${url.searchParams.toString()}`;
      return c.redirect(consentUrl);
    }
    if (!session.currentTeamId) {
      return c.redirect(
        redirectError(
          redirectUri,
          "access_denied",
          "no active workspace for this account",
          state,
        ),
      );
    }

    const grant: StoredGrant = {
      clientId,
      redirectUri,
      codeChallenge,
      resource: resource || MCP_RESOURCE_URL,
      scope: scope || SUPPORTED_SCOPES.join(" "),
      userId: session.userId,
      teamId: session.currentTeamId,
      environmentId: session.activeEnvironmentId,
    };
    const code = randomBytes(32).toString("base64url");
    await putEphemeral(
      `mcp:code:${code}`,
      JSON.stringify(grant),
      CODE_TTL_SECONDS,
    );

    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return c.redirect(redirect.toString());
  });

  routes.post("/token", async (c: Context) => {
    if (!MCP_OAUTH_SECRET) {
      return oauthError(c, "server_error", "OAuth is not configured");
    }

    let params: Record<string, string> = {};
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await c.req.json()) as Record<string, unknown>;
        params = Object.fromEntries(
          Object.entries(body).map(([key, value]) => [key, String(value)]),
        );
      } catch {
        params = {};
      }
    } else {
      const body = await c.req.parseBody();
      params = Object.fromEntries(
        Object.entries(body).map(([key, value]) => [key, String(value)]),
      );
    }

    if (params.grant_type === "authorization_code") {
      return handleAuthorizationCode(c, params);
    }
    if (params.grant_type === "refresh_token") {
      return handleRefreshToken(c, params);
    }
    return oauthError(
      c,
      "unsupported_grant_type",
      "grant_type must be authorization_code or refresh_token",
    );
  });

  return routes;
}

async function handleAuthorizationCode(
  c: Context,
  params: Record<string, string>,
) {
  const code = params.code;
  const verifier = params.code_verifier;
  if (!code || !verifier) {
    return oauthError(c, "invalid_request", "code and code_verifier are required");
  }

  const raw = await takeEphemeral(`mcp:code:${code}`);
  if (!raw) {
    return oauthError(
      c,
      "invalid_grant",
      "authorization code is invalid, expired, or already used",
    );
  }
  let grant: StoredGrant;
  try {
    grant = JSON.parse(raw);
  } catch {
    return oauthError(c, "invalid_grant", "malformed grant");
  }

  if (params.client_id && grant.clientId && params.client_id !== grant.clientId) {
    return oauthError(c, "invalid_grant", "client_id mismatch");
  }
  if (
    params.redirect_uri &&
    grant.redirectUri &&
    params.redirect_uri !== grant.redirectUri
  ) {
    return oauthError(c, "invalid_grant", "redirect_uri mismatch");
  }
  if (params.resource && !resourceMatches(params.resource)) {
    return oauthError(c, "invalid_target", "resource mismatch");
  }

  const challenge = createHash("sha256").update(verifier).digest("base64url");
  if (!secureCompare(challenge, grant.codeChallenge)) {
    return oauthError(c, "invalid_grant", "PKCE verification failed");
  }

  return issueTokens(c, grant);
}

async function handleRefreshToken(c: Context, params: Record<string, string>) {
  const token = params.refresh_token;
  if (!token) {
    return oauthError(c, "invalid_request", "refresh_token is required");
  }
  const raw = await takeEphemeral(`mcp:refresh:${token}`);
  if (!raw) {
    return oauthError(
      c,
      "invalid_grant",
      "refresh token is invalid, expired, or already used",
    );
  }
  let grant: StoredGrant;
  try {
    grant = JSON.parse(raw);
  } catch {
    return oauthError(c, "invalid_grant", "malformed grant");
  }
  return issueTokens(c, grant);
}

async function issueTokens(c: Context, grant: StoredGrant) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signAccessToken({
    iss: MCP_OAUTH_ISSUER || MCP_RESOURCE_URL,
    aud: grant.resource || MCP_RESOURCE_URL,
    sub: grant.userId,
    teamId: grant.teamId,
    environmentId: grant.environmentId,
    scope: grant.scope,
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
    jti: randomBytes(8).toString("hex"),
  });
  const refreshToken = randomBytes(32).toString("base64url");
  await putEphemeral(
    `mcp:refresh:${refreshToken}`,
    JSON.stringify(grant),
    REFRESH_TTL_SECONDS,
  );

  return c.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: grant.scope,
    },
    200 as any,
  );
}
