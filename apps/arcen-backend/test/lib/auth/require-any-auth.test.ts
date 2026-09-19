import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db.js", () => ({
  db: {
    arcenApiKey: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../../src/lib/auth/arcjet.js", () => ({
  aj: { withRule: () => ({ protect: vi.fn(async () => ({ isDenied: () => false })) }) },
  fixedWindow: () => ({}),
  isDocsApiOrigin: vi.fn(() => false),
  shouldBypassGlobalProtection: vi.fn(() => false),
}));

vi.mock("../../../src/lib/auth/auth.server.js", () => ({
  getSessionFromCtx: vi.fn(),
}));

vi.mock("../../../src/lib/auth/team-session.js", () => ({
  resolveTeamContext: vi.fn(),
}));

import { generateApiKey } from "../../../src/lib/auth/api-key-auth.js";
import { requireAnyAuth } from "../../../src/lib/auth/require-any-auth.js";
import { db } from "../../../src/db.js";
import { getSessionFromCtx } from "../../../src/lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../src/lib/auth/team-session.js";

const mockDb = db as any;
const mockGetSession = getSessionFromCtx as any as ReturnType<typeof vi.fn>;
const mockResolveTeam = resolveTeamContext as any as ReturnType<typeof vi.fn>;

function ctxWithAuth(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers["authorization"] = authHeader;
  const request = new Request("https://api.example.com/v1/x", { headers });
  return {
    req: {
      raw: request,
      header: (name: string) => headers[name] ?? null,
    },
  } as any;
}

describe("requireAnyAuth with Stripe-style credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockResolveTeam.mockResolvedValue(null);
    mockDb.arcenApiKey.update.mockResolvedValue({ id: "key-1" });
  });

  it("authenticates SECRET (sk_) keys via the API-key path", async () => {
    const { raw } = generateApiKey({ type: "SECRET", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      teamId: "team-1",
      environmentId: "env-1",
      type: "SECRET",
      permissions: [],
      revokedAt: null,
      expiresAt: null,
      environmentMode: "PRODUCTION",
    });

    const result = await requireAnyAuth(ctxWithAuth(`Bearer ${raw}`));
    expect(result).toMatchObject({
      teamId: "team-1",
      source: "api_key",
      activeEnvironmentId: "env-1",
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("authenticates PUBLISHABLE (pk_) keys via the API-key path", async () => {
    const { raw } = generateApiKey({ type: "PUBLISHABLE", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      teamId: "team-1",
      environmentId: null,
      type: "PUBLISHABLE",
      permissions: [],
      revokedAt: null,
      expiresAt: null,
      environmentMode: "PRODUCTION",
    });

    const result = await requireAnyAuth(ctxWithAuth(`Bearer ${raw}`));
    expect(result).toMatchObject({
      teamId: "team-1",
      source: "api_key",
      activeEnvironmentId: null,
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("rejects the REMOVED legacy api_ prefix (not an API key anymore)", async () => {
    const result = await requireAnyAuth(ctxWithAuth("Bearer api_legacykey123"));
    // `api_` is no longer a recognized credential — it falls through to the
    // session-less path and returns 401, never hitting the API-key lookup.
    expect(result).toMatchObject({ status: 401 });
    expect(mockDb.arcenApiKey.findUnique).not.toHaveBeenCalled();
  });

  it("does not route embed access tokens (arc_tok_) to the API-key path", async () => {
    const result = await requireAnyAuth(ctxWithAuth("Bearer arc_tok_something"));
    // Falls through to session-less path -> 401 Unauthorized, not "Invalid API key"
    expect(result).toMatchObject({ status: 401 });
    expect(mockDb.arcenApiKey.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to session auth when no credential is present", async () => {
    mockGetSession.mockResolvedValue({ sessionId: "sess-1", activeEnvironmentId: "env-9" });
    mockResolveTeam.mockResolvedValue({ teamId: "team-1", teamRole: "OWNER" });
    const result = await requireAnyAuth(ctxWithAuth());
    expect(result).toMatchObject({ teamId: "team-1", source: "session", sessionId: "sess-1" });
    expect(mockDb.arcenApiKey.findUnique).not.toHaveBeenCalled();
  });
});
