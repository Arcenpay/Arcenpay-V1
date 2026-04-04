import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { resolveEntitlementResults } from "@/lib/entitlements";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { db } from "@/lib/db";

vi.mock("@/lib/entitlements", () => ({
  resolveEntitlementResults: vi.fn(),
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

const mockResolveEntitlementResults = vi.mocked(resolveEntitlementResults);
const mockResolveEmbedAccessToken = vi.mocked(resolveEmbedAccessToken);

describe("GET /api/v1/entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      teamId: "team_1",
      id: "key_1",
    });
  });

  it("returns a bulk entitlement list for API key auth", async () => {
    mockResolveEntitlementResults.mockResolvedValue({
      entitlements: [
        {
          key: "advanced_analytics",
          enabled: true,
          reason: "Rule 1 matched",
          allocation: null,
          usage: 0,
          exceeded: false,
        },
        {
          key: "api_calls",
          enabled: true,
          reason: "Plan entitlement",
          allocation: 1000,
          usage: 20,
          exceeded: false,
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/v1/entitlements", {
      headers: {
        Authorization: "Bearer api_test",
        "X-Arcen-Company-Keys": "wallet=0x0000000000000000000000000000000000000001",
      },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entitlements).toHaveLength(2);
    expect(json.entitlements[1].allocation).toBe(1000);
  });

  it("returns a bulk entitlement list for embed access token auth", async () => {
    mockResolveEmbedAccessToken.mockResolvedValue({
      teamId: "team_1",
      companyId: "company_1",
      userId: "user_1",
    });
    mockResolveEntitlementResults.mockResolvedValue({
      entitlements: [
        {
          key: "advanced_analytics",
          enabled: false,
          reason: "Default rule (no targeting rule matched)",
          allocation: null,
          usage: 0,
          exceeded: false,
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/v1/entitlements", {
      headers: { Authorization: "Bearer embedded_token" },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entitlements[0].key).toBe("advanced_analytics");
  });
});
