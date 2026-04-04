import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { consumeMeteredEntitlement } from "@/lib/usage-consume";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { db } from "@/lib/db";

vi.mock("@/lib/usage-consume", () => ({
  consumeMeteredEntitlement: vi.fn(),
  ConsumeEntitlementError: class ConsumeEntitlementError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
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

const mockConsumeMeteredEntitlement = vi.mocked(consumeMeteredEntitlement);
const mockResolveEmbedAccessToken = vi.mocked(resolveEmbedAccessToken);

describe("POST /api/v1/usage/consume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      teamId: "team_1",
      id: "key_1",
    });
  });

  it("consumes a metered feature for API key auth", async () => {
    mockConsumeMeteredEntitlement.mockResolvedValue({
      key: "scan",
      enabled: false,
      reason: "Rule 101 matched · limit reached",
      allocation: 15,
      usage: 15,
      exceeded: true,
      consumed: true,
    });

    const req = new NextRequest("http://localhost/api/v1/usage/consume", {
      method: "POST",
      headers: {
        Authorization: "Bearer api_test",
        "Content-Type": "application/json",
        "X-Arcen-Company-Keys":
          "wallet=0x0000000000000000000000000000000000000001",
      },
      body: JSON.stringify({ featureKey: "scan", idempotencyKey: "scan-1" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.consumed).toBe(true);
    expect(json.key).toBe("scan");
  });

  it("supports embed access token auth", async () => {
    mockResolveEmbedAccessToken.mockResolvedValue({
      teamId: "team_1",
      companyId: "company_1",
      userId: "user_1",
    });
    mockConsumeMeteredEntitlement.mockResolvedValue({
      key: "scan",
      enabled: false,
      reason: "Rule 101 matched · limit reached",
      allocation: 15,
      usage: 16,
      exceeded: true,
      consumed: false,
    });

    const req = new NextRequest("http://localhost/api/v1/usage/consume", {
      method: "POST",
      headers: {
        Authorization: "Bearer embedded_token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ featureKey: "scan" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.consumed).toBe(false);
    expect(json.exceeded).toBe(true);
  });
});
