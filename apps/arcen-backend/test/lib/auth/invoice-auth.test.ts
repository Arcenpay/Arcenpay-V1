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
  arcjetNodeRequest: vi.fn((r: any) => r),
}));

vi.mock("../../../src/lib/auth/auth.server.js", () => ({
  getSessionFromCtx: vi.fn(),
}));

vi.mock("../../../src/lib/auth/team-session.js", () => ({
  resolveTeamContext: vi.fn(),
}));

import { generateApiKey } from "../../../src/lib/auth/api-key-auth.js";
import { requireInvoiceAuth } from "../../../src/lib/auth/invoice-auth.js";
import { db } from "../../../src/db.js";
import { getSessionFromCtx } from "../../../src/lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../src/lib/auth/team-session.js";

const mockDb = db as any;
const mockGetSession = getSessionFromCtx as any as ReturnType<typeof vi.fn>;
const mockResolveTeam = resolveTeamContext as any as ReturnType<typeof vi.fn>;

function ctxWithAuth(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers["authorization"] = authHeader;
  const request = new Request("https://api.example.com/v1/invoices", { headers });
  return {
    req: {
      raw: request,
      header: (name: string) => headers[name] ?? null,
    },
  } as any;
}

function keyRecord(raw: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    teamId: "team-1",
    environmentId: "env-1",
    type: "SECRET",
    permissions: ["invoices.read"],
    revokedAt: null,
    expiresAt: null,
    environmentMode: "PRODUCTION",
    ...overrides,
  };
}

describe("requireInvoiceAuth (Stripe-style invoice API access)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockResolveTeam.mockResolvedValue(null);
    mockDb.arcenApiKey.update.mockResolvedValue({ id: "key-1" });
  });

  it("allows a SECRET key with invoices.read to read invoices", async () => {
    const { raw } = generateApiKey({ type: "SECRET", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(keyRecord(raw));
    const result = await requireInvoiceAuth(ctxWithAuth(`Bearer ${raw}`), {
      rolePermission: "invoices:read",
      apiPermission: "read",
    });
    expect(result).toMatchObject({
      teamId: "team-1",
      source: "api_key",
      environmentId: "env-1",
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("rejects a PUBLISHABLE key even for read (invoice data is never client-safe)", async () => {
    const { raw } = generateApiKey({ type: "PUBLISHABLE", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(
      keyRecord(raw, { type: "PUBLISHABLE", permissions: [] }),
    );
    const result = await requireInvoiceAuth(ctxWithAuth(`Bearer ${raw}`), {
      rolePermission: "invoices:read",
      apiPermission: "read",
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it("rejects a RESTRICTED key missing invoice permissions", async () => {
    const { raw } = generateApiKey({ type: "RESTRICTED", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(
      keyRecord(raw, { type: "RESTRICTED", permissions: ["customers.read"] }),
    );
    const result = await requireInvoiceAuth(ctxWithAuth(`Bearer ${raw}`), {
      rolePermission: "invoices:read",
      apiPermission: "read",
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it("allows a key with invoices.write to perform a write", async () => {
    const { raw } = generateApiKey({ type: "SECRET", mode: "PRODUCTION" });
    mockDb.arcenApiKey.findUnique.mockResolvedValue(
      keyRecord(raw, { permissions: ["invoices.write"] }),
    );
    const result = await requireInvoiceAuth(ctxWithAuth(`Bearer ${raw}`), {
      rolePermission: "invoices:write",
      apiPermission: "write",
    });
    expect(result).toMatchObject({ source: "api_key", teamId: "team-1" });
  });

  it("falls back to a dashboard session with the RBAC permission", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "sess-1",
      activeEnvironmentId: "env-9",
    });
    mockResolveTeam.mockResolvedValue({
      teamId: "team-1",
      teamRole: "FINANCE",
      userId: "user-1",
      walletAddress: "0xabc",
    });
    const result = await requireInvoiceAuth(ctxWithAuth(), {
      rolePermission: "invoices:read",
      apiPermission: "read",
    });
    expect(result).toMatchObject({
      teamId: "team-1",
      source: "session",
      environmentId: "env-9",
    });
    expect(mockDb.arcenApiKey.findUnique).not.toHaveBeenCalled();
  });
});
