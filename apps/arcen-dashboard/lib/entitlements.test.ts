import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEntitlementResults } from "./entitlements";
import { aggregateUsage } from "./event-aggregator";
import { resolveCompany, resolveUser } from "./flag-engine";
import { db } from "./db";

vi.mock("./event-aggregator", () => ({
  aggregateUsage: vi.fn(),
}));

vi.mock("./flag-engine", () => ({
  resolveCompany: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("./db", () => ({
  db: {
    catalogPlan: {
      findFirst: vi.fn(),
    },
    catalogAddOn: {
      findMany: vi.fn(),
    },
    catalogFeatureFlag: {
      findMany: vi.fn(),
    },
    companyOverride: {
      findMany: vi.fn(),
    },
  },
}));

const mockAggregateUsage = vi.mocked(aggregateUsage);
const mockResolveCompany = vi.mocked(resolveCompany);
const mockResolveUser = vi.mocked(resolveUser);

describe("resolveEntitlementResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveCompany.mockResolvedValue({
      id: "company_1",
      traits: {},
      activePlanId: "plan_1",
      activeAddOnIds: [],
    });
    mockResolveUser.mockResolvedValue(null);
    mockAggregateUsage.mockResolvedValue(0);

    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "plan_1",
      metadata: {
        entitlements: [
          {
            featureKey: "scan",
            featureName: "Scan",
            type: "NUMERIC",
            value: 3,
            enabled: true,
          },
        ],
      },
    });
    (db.catalogAddOn.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.catalogFeatureFlag.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        featureKey: "scan",
        featureType: "event_based",
        defaultValue: false,
        eventKey: "scan",
        rules: [
          {
            priority: 100,
            value: true,
            conditions: [
              {
                criteriaType: "base_plan",
                operator: "is_one_of",
                values: ["plan_1"],
              },
            ],
          },
        ],
      },
      {
        featureKey: "ai_summary",
        featureType: "boolean",
        defaultValue: true,
        eventKey: null,
        rules: [],
      },
      {
        featureKey: "priority_support",
        featureType: "boolean",
        defaultValue: false,
        eventKey: null,
        rules: [
          {
            priority: 100,
            value: true,
            conditions: [
              {
                criteriaType: "company_trait",
                operator: "is_one_of",
                traitKey: "beta_access",
                values: ["true"],
              },
            ],
          },
        ],
      },
    ]);
    (db.companyOverride.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("disables a metered entitlement once allocation is exceeded", async () => {
    mockAggregateUsage.mockResolvedValue(10);

    const result = await resolveEntitlementResults({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      featureKeys: ["scan"],
    });

    expect(result.entitlements).toEqual([
      expect.objectContaining({
        key: "scan",
        enabled: false,
        allocation: 3,
        usage: 10,
        exceeded: true,
      }),
    ]);
    expect(result.entitlements[0]?.reason).toContain("limit reached");
  });

  it("keeps a metered entitlement enabled while under allocation", async () => {
    mockAggregateUsage.mockResolvedValue(2);

    const result = await resolveEntitlementResults({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      featureKeys: ["scan"],
    });

    expect(result.entitlements).toEqual([
      expect.objectContaining({
        key: "scan",
        enabled: true,
        allocation: 3,
        usage: 2,
        exceeded: false,
      }),
    ]);
  });

  it("does not expose default-on flags that are not included in the active plan", async () => {
    const result = await resolveEntitlementResults({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      featureKeys: ["ai_summary"],
    });

    expect(result.entitlements).toEqual([
      expect.objectContaining({
        key: "ai_summary",
        enabled: false,
        reason: "Not included in the current plan",
      }),
    ]);
  });

  it("still enables targeted flags even when the plan metadata does not list them", async () => {
    mockResolveCompany.mockResolvedValue({
      id: "company_1",
      traits: { beta_access: "true" },
      activePlanId: "plan_1",
      activeAddOnIds: [],
    });

    const result = await resolveEntitlementResults({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      featureKeys: ["priority_support"],
    });

    expect(result.entitlements).toEqual([
      expect.objectContaining({
        key: "priority_support",
        enabled: true,
        reason: "Rule 101 matched",
      }),
    ]);
  });
});
