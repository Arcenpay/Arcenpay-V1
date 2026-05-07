import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "../route";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { syncEntitlementsToFlagRules } from "@/lib/sync-entitlements";

vi.mock("@/lib/api-auth", () => ({
  requirePermission: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("@/lib/sync-entitlements", () => ({
  syncEntitlementsToFlagRules: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/db", () => ({
  db: {
    catalogPlan: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("PUT /api/catalog/plans/[id]/entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      team: { teamId: "team_1" },
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(isErrorResponse).mockReturnValue(false);
    vi.mocked(db.catalogPlan.findFirst).mockResolvedValue({
      id: "plan_1",
      teamId: "team_1",
      metadata: {
        entitlements: [
          {
            featureName: "Scan",
            featureKey: "scan",
            type: "NUMERIC",
            value: 10,
            valueUnit: "scans",
            enabled: true,
          },
        ],
      },
    } as never);
    vi.mocked(db.catalogPlan.update).mockResolvedValue({ id: "plan_1" } as never);
  });

  it("updates numeric entitlements including their unit label", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/catalog/plans/plan_1/entitlements", {
        method: "PUT",
        body: JSON.stringify({
          featureKey: "scan",
          value: 25,
          valueUnit: "api calls",
          enabled: true,
        }),
      }),
      { params: Promise.resolve({ id: "plan_1" }) },
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(db.catalogPlan.update).toHaveBeenCalledWith({
      where: { id: "plan_1" },
      data: {
        metadata: {
          entitlements: [
            {
              featureName: "Scan",
              featureKey: "scan",
              type: "NUMERIC",
              value: 25,
              valueUnit: "api calls",
              enabled: true,
            },
          ],
        },
      },
    });
    expect(syncEntitlementsToFlagRules).toHaveBeenCalledWith(
      "team_1",
      "plan_1",
      [
        {
          featureName: "Scan",
          featureKey: "scan",
          type: "NUMERIC",
          value: 25,
          valueUnit: "api calls",
          enabled: true,
        },
      ],
    );
    expect(json.entitlements[0]).toEqual(
      expect.objectContaining({
        featureKey: "scan",
        value: 25,
        valueUnit: "api calls",
      }),
    );
  });
});
