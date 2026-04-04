import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { resolveEntitlementResult } from "@/lib/entitlements";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { db } from "@/lib/db";

vi.mock("@/lib/entitlements", () => ({
  resolveEntitlementResult: vi.fn(),
}));

vi.mock("@/lib/embed-access-token", () => ({
  resolveEmbedAccessToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arcenApiKey: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({
    ok: true,
    remaining: 499,
    resetAt: Date.now() + 60_000,
  })),
  applyRateLimitHeaders: vi.fn(),
}));

const mockResolveEntitlementResult = vi.mocked(resolveEntitlementResult);
const mockResolveEmbedAccessToken = vi.mocked(resolveEmbedAccessToken);

describe("GET /api/v1/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      teamId: "team_1",
      id: "key_1",
    });
  });

  it("returns 400 when key is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/check", {
      headers: { Authorization: "Bearer api_test" },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns a canonical entitlement payload for API key auth", async () => {
    mockResolveEntitlementResult.mockResolvedValue({
      key: "advanced_analytics",
      enabled: true,
      reason: "Rule 1 matched",
      allocation: null,
      usage: 0,
      exceeded: false,
    });

    const req = new NextRequest(
      "http://localhost/api/v1/check?key=advanced_analytics",
      {
        headers: {
          Authorization: "Bearer api_test",
          "X-Arcen-Company-Keys": "id=co_1",
        },
      },
    );
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      key: "advanced_analytics",
      enabled: true,
      reason: "Rule 1 matched",
      allocation: null,
      usage: 0,
      exceeded: false,
    });
  });

  it("supports embed access token auth", async () => {
    mockResolveEmbedAccessToken.mockResolvedValue({
      teamId: "team_1",
      companyId: "company_1",
      userId: "user_1",
    });
    mockResolveEntitlementResult.mockResolvedValue({
      key: "api_calls",
      enabled: true,
      reason: "Plan entitlement",
      allocation: 1000,
      usage: 247,
      exceeded: false,
    });

    const req = new NextRequest("http://localhost/api/v1/check?key=api_calls", {
      headers: { Authorization: "Bearer embedded_token" },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.allocation).toBe(1000);
    expect(json.usage).toBe(247);
    expect(json.exceeded).toBe(false);
  });

  it("returns 401 for an invalid embed access token", async () => {
    mockResolveEmbedAccessToken.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/check?key=api_calls", {
      headers: { Authorization: "Bearer invalid_token" },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
