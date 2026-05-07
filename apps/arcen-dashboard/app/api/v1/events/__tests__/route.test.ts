import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";

vi.mock("@/lib/require-any-auth", () => ({
  requireAnyAuth: vi.fn(),
  isAnyAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/api-auth", () => ({
  requirePermission: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arcenCompany: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    arcenUser: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    arcenEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/deliver-webhook", () => ({
  deliverWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/event-aggregator", () => ({
  invalidateUsageCache: vi.fn(),
}));

vi.mock("@/lib/flag-cache", () => ({
  invalidateFlagCache: vi.fn(),
}));

vi.mock("@/lib/embed-access-token", () => ({
  resolveEmbedAccessToken: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/activity", () => ({
  touchEntityActivity: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/entitlements", () => ({
  resolveEntitlementResult: vi.fn(() => Promise.resolve(null)),
}));

describe("POST /api/v1/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyAuth).mockResolvedValue({
      teamId: "team_1",
      source: "api_key",
    } as Awaited<ReturnType<typeof requireAnyAuth>>);
    vi.mocked(isAnyAuthError).mockReturnValue(false);
  });

  it("creates an email-only user during identify when a company is present", async () => {
    vi.mocked(db.arcenCompany.findFirst).mockResolvedValueOnce({
      id: "company_1",
      traits: {},
    } as never);
    vi.mocked(db.arcenCompany.update).mockResolvedValue({ id: "company_1" } as never);
    vi.mocked(db.arcenUser.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(db.arcenUser.create).mockResolvedValue({
      id: "user_1",
    } as never);

    const response = await POST(
      new NextRequest("http://localhost/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer api_test",
        },
        body: JSON.stringify({
          event_type: "identify",
          company: {
            id: "acme_company",
            email: "team@acme.com",
            name: "Acme",
          },
          user: {
            email: "jane@acme.com",
            name: "Jane",
          },
        }),
      }),
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(db.arcenUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: "team_1",
        companyId: "company_1",
        name: "Jane",
        email: "jane@acme.com",
      }),
    });
    expect(json.data).toEqual({
      companyId: "company_1",
      userId: "user_1",
    });
  });
});
