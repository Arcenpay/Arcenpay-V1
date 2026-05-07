import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

vi.mock("@/lib/api-auth", () => ({
  requirePermission: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    catalogFeatureFlag: {
      findMany: vi.fn(),
    },
    catalogPlan: {
      findMany: vi.fn(),
    },
  },
}));

describe("GET /api/v1/features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      team: { teamId: "team_1" },
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(isErrorResponse).mockReturnValue(false);
  });

  it("hydrates linked plans from plan catalog entitlements", async () => {
    vi.mocked(db.catalogFeatureFlag.findMany).mockResolvedValue([
      {
        id: "flag_1",
        name: "AI Summary",
        featureKey: "ai_summary",
        featureType: "boolean",
        eventKey: null,
        description: "Summarize content",
        createdAt: new Date("2026-04-23T00:00:00.000Z"),
      },
      {
        id: "flag_2",
        name: "Exports",
        featureKey: "exports",
        featureType: "event_based",
        eventKey: "export_used",
        description: null,
        createdAt: new Date("2026-04-24T00:00:00.000Z"),
      },
    ] as never);

    vi.mocked(db.catalogPlan.findMany).mockResolvedValue([
      {
        id: "plan_pro",
        name: "Pro",
        metadata: {
          entitlements: [
            { featureKey: "ai_summary", enabled: true },
            { featureKey: "exports", enabled: true },
          ],
        },
      },
      {
        id: "plan_starter",
        name: "Starter",
        metadata: {
          entitlements: [
            { featureKey: "ai_summary", enabled: false },
          ],
        },
      },
      {
        id: "plan_team",
        name: "Team",
        metadata: {
          entitlements: [
            { featureKey: "ai_summary", enabled: true },
          ],
        },
      },
    ] as never);

    const response = await GET(new NextRequest("http://localhost/api/v1/features"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.features).toEqual([
      expect.objectContaining({
        id: "flag_1",
        featureKey: "ai_summary",
        linkedPlans: ["Pro", "Team"],
      }),
      expect.objectContaining({
        id: "flag_2",
        featureKey: "exports",
        linkedPlans: ["Pro"],
      }),
    ]);
  });
});
