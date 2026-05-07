import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, PUT } from "../route";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { invalidateFlagCache } from "@/lib/flag-cache";

vi.mock("@/lib/api-auth", () => ({
  requirePermission: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("@/lib/flag-cache", () => ({
  invalidateFlagCache: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    catalogFeatureFlag: {
      findFirst: vi.fn(),
    },
    flagRule: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("/api/v1/feature-flags/[id]/rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      team: { teamId: "team_1" },
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(isErrorResponse).mockReturnValue(false);
    vi.mocked(db.catalogFeatureFlag.findFirst).mockResolvedValue({ id: "flag_1" } as never);
  });

  it("rejects creating base plan rules from the Flags API", async () => {
    const request = new NextRequest("http://localhost/api/v1/feature-flags/flag_1/rules", {
      method: "POST",
      body: JSON.stringify({
        priority: 0,
        value: true,
        conditions: [
          {
            criteriaType: "base_plan",
            operator: "is_one_of",
            values: ["plan_pro"],
          },
        ],
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "flag_1" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Plan Catalog");
    expect(db.flagRule.create).not.toHaveBeenCalled();
  });

  it("replaces only editable rules and preserves plan-managed rule scopes", async () => {
    vi.mocked(db.flagRule.deleteMany).mockReturnValue("deleteMany" as never);
    vi.mocked(db.flagRule.create).mockReturnValue("createRule" as never);
    vi.mocked(db.$transaction).mockResolvedValue([]);

    const request = new NextRequest("http://localhost/api/v1/feature-flags/flag_1/rules", {
      method: "PUT",
      body: JSON.stringify({
        rules: [
          {
            priority: 0,
            value: true,
            conditions: [
              {
                criteriaType: "company_trait",
                operator: "equals",
                traitKey: "segment",
                values: ["beta"],
              },
            ],
          },
        ],
      }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ id: "flag_1" }),
    });

    expect(response.status).toBe(200);
    expect(db.flagRule.deleteMany).toHaveBeenCalledWith({
      where: {
        flagId: "flag_1",
        NOT: {
          source: "plan",
        },
      },
    });
    expect(db.flagRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flagId: "flag_1",
          source: "manual",
        }),
      }),
    );
    expect(invalidateFlagCache).toHaveBeenCalledWith("team_1:");
  });
});
