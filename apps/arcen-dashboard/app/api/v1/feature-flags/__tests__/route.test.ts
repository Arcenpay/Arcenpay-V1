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

describe("GET /api/v1/feature-flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      team: { teamId: "team_1" },
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(isErrorResponse).mockReturnValue(false);
  });

  it("builds live plan entitlement rules from published catalog metadata and filters manual editor rules", async () => {
    vi.mocked(db.catalogFeatureFlag.findMany).mockResolvedValue([
      {
        id: "flag_1",
        name: "API access",
        featureKey: "api_access",
        description: null,
        featureType: "boolean",
        eventKey: null,
        defaultValue: false,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        teamId: "team_1",
        unitSingular: null,
        unitPlural: null,
        rules: [
          {
            id: "rule_plan",
            flagId: "flag_1",
            priority: 100,
            value: true,
            source: "plan",
            sourceId: "plan_old",
            conditions: [
              {
                id: "cond_plan",
                ruleId: "rule_plan",
                criteriaType: "base_plan",
                operator: "is_one_of",
                values: ["plan_old"],
                metricKey: null,
                metricValue: null,
                metricPeriod: null,
                traitKey: null,
                zktlsProviderId: null,
              },
            ],
          },
          {
            id: "rule_manual",
            flagId: "flag_1",
            priority: 0,
            value: true,
            source: "manual",
            sourceId: null,
            conditions: [
              {
                id: "cond_trait",
                ruleId: "rule_manual",
                criteriaType: "company_trait",
                operator: "equals",
                values: ["beta"],
                metricKey: null,
                metricValue: null,
                metricPeriod: null,
                traitKey: "segment",
                zktlsProviderId: null,
              },
            ],
          },
        ],
      },
    ] as never);

    vi.mocked(db.catalogPlan.findMany).mockResolvedValue([
      {
        id: "plan_pro",
        name: "Pro",
        tier: "pro",
        metadata: {
          entitlements: [
            {
              featureKey: "api_access",
              type: "NUMERIC",
              value: 300,
              valueUnit: "api calls",
              enabled: true,
            },
          ],
        },
      },
      {
        id: "plan_old",
        name: "Pro",
        tier: "legacy",
        metadata: {
          entitlements: [
            { featureKey: "other_feature", enabled: true },
          ],
        },
      },
    ] as never);

    const response = await GET(new NextRequest("http://localhost/api/v1/feature-flags"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual([
      expect.objectContaining({
        id: "flag_1",
        rules: [
          expect.objectContaining({
            id: "rule_manual",
          }),
        ],
        linkedPlans: [
          expect.objectContaining({
            id: "plan_pro",
            name: "Pro",
            tier: "pro",
          }),
        ],
        planEntitlements: [
          expect.objectContaining({
            id: "plan_pro",
            type: "NUMERIC",
            value: 300,
            valueUnit: "api calls",
          }),
        ],
        planRules: [
          expect.objectContaining({
            source: "plan",
            sourceId: "plan_pro",
            conditions: expect.arrayContaining([
              expect.objectContaining({
                criteriaType: "base_plan",
                values: ["plan_pro"],
              }),
              expect.objectContaining({
                criteriaType: "usage",
                metricKey: "api_access",
                metricValue: 300,
                metricPeriod: "monthly",
              }),
            ]),
          }),
        ],
      }),
    ]);
  });
});
