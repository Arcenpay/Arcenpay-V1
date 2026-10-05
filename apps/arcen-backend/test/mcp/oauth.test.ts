import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  process.env.MCP_OAUTH_SECRET = "test-oauth-secret";
  process.env.MCP_RESOURCE_URL = "https://mcp.test";
  process.env.MCP_OAUTH_ISSUER = "https://mcp.test";
  process.env.APP_URL = "https://app.test";
});

vi.mock("../../src/lib/redis.js", () => ({
  getRedis: () => null,
  isRedisConfigured: () => false,
}));

vi.mock("../../src/lib/auth/auth.server.js", () => ({
  getSessionFromCtx: vi.fn(async () => ({
    sessionId: "sess_1",
    userId: "user_1",
    clerkUserId: "user_1",
    email: "demo@arcenpay.com",
    currentTeamId: "team_1",
    activeEnvironmentId: "env_1",
    walletAddress: null,
    stellarWalletAddress: null,
    solanaWalletAddress: null,
    expiresAt: new Date(Date.now() + 3600_000),
  })),
}));

import { Hono } from "hono";
import {
  createOAuthRoutes,
  verifyMcpAccessToken,
  protectedResourceMetadata,
  authorizationServerMetadata,
} from "../../src/mcp/oauth.js";
import { resolveMcpAuth } from "../../src/mcp/auth.js";

const CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER = "test-code-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

function oauthApp() {
  return new Hono().route("/oauth", createOAuthRoutes());
}

async function authorize(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    resource: "https://mcp.test",
    ...overrides,
  });
  return oauthApp().request(
    `https://mcp.test/oauth/authorize?${params.toString()}`,
  );
}

async function postToken(body: Record<string, string>) {
  return oauthApp().request("https://mcp.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

function codeFrom(res: Response): string {
  const location = new URL(res.headers.get("location") ?? "");
  return location.searchParams.get("code") ?? "";
}

describe("hosted MCP OAuth 2.1", () => {
  it("authorize redirects back with a code and state", async () => {
    const res = await authorize();
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges a code for an access token the MCP accepts", async () => {
    const code = codeFrom(await authorize());
    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: "https://mcp.test",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string; token_type: string };

    const claims = verifyMcpAccessToken(json.access_token);
    expect(claims?.teamId).toBe("team_1");

    const auth = await resolveMcpAuth(
      new Request("https://mcp.test/mcp", {
        headers: { authorization: `Bearer ${json.access_token}` },
      }),
    );
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.auth.teamId).toBe("team_1");
      expect(auth.auth.environmentId).toBe("env_1");
    }
  });

  it("rejects a wrong PKCE verifier", async () => {
    const code = codeFrom(await authorize());
    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: "wrong-verifier",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("authorization codes are single-use", async () => {
    const code = codeFrom(await authorize());
    const first = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
    });
    expect(first.status).toBe(200);

    const second = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
    });
    expect(second.status).toBe(400);
  });

  it("rotates refresh tokens", async () => {
    const code = codeFrom(await authorize());
    const first = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
    });
    const refreshToken = ((await first.json()) as { refresh_token: string })
      .refresh_token;

    const res = await postToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { access_token: string }).access_token,
    ).toBeTruthy();
  });

  it("rejects a redirect_uri from a different origin than the client", async () => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://evil.example.com/callback",
      response_type: "code",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });
    const res = await oauthApp().request(
      `https://mcp.test/oauth/authorize?${params.toString()}`,
    );
    expect(res.status).toBe(400);
  });

  it("advertises the MCP authorization contract", () => {
    expect(protectedResourceMetadata().resource).toBe("https://mcp.test");
    const server = authorizationServerMetadata();
    expect(server.code_challenge_methods_supported).toContain("S256");
    expect(server.token_endpoint).toBe("https://mcp.test/oauth/token");
    expect(server.client_id_metadata_document_supported).toBe(true);
  });
});
