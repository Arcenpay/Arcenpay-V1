import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEntitlementsToFlagRules } from "./sync-entitlements";
import { db } from "./db";

// Mock db
vi.mock("./db", () => ({
  db: {
    catalogFeatureFlag: {
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    flagRule: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    flagRuleCondition: { create: vi.fn() },
  },
}));

describe("syncEntitlementsToFlagRules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts a CatalogFeatureFlag for each enabled entitlement", async () => {
    (db.catalogFeatureFlag.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flag_1" });
    (db.flagRule.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rule_1" });

    await syncEntitlementsToFlagRules("team_1", "plan_1", [
      { featureName: "Advanced Analytics", featureKey: "advanced_analytics", type: "BOOLEAN", value: true, enabled: true },
    ]);

    expect(db.catalogFeatureFlag.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId_featureKey: { teamId: "team_1", featureKey: "advanced_analytics" } },
      create: expect.objectContaining({ featureKey: "advanced_analytics", featureType: "boolean" }),
    }));
  });

  it("creates a FlagRule with source=plan and sourceId=planId", async () => {
    (db.catalogFeatureFlag.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flag_1" });
    (db.flagRule.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rule_1" });

    await syncEntitlementsToFlagRules("team_1", "plan_1", [
      { featureName: "API Calls", featureKey: "api_calls", type: "NUMERIC", value: 1000, enabled: true },
    ]);

    expect(db.flagRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: "plan", sourceId: "plan_1", value: true, priority: 100 }),
    }));
  });

  it("creates a FlagRuleCondition with criteriaType=base_plan and the planId in values", async () => {
    (db.catalogFeatureFlag.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flag_1" });
    (db.flagRule.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rule_1" });

    await syncEntitlementsToFlagRules("team_1", "plan_1", [
      { featureName: "Webhooks", featureKey: "webhooks", type: "BOOLEAN", value: true, enabled: true },
    ]);

    expect(db.flagRuleCondition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        criteriaType: "base_plan",
        operator: "is_one_of",
        values: ["plan_1"],
      }),
    }));
  });

  it("deletes existing plan rules before recreating them", async () => {
    (db.catalogFeatureFlag.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flag_1" });
    (db.flagRule.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rule_1" });

    await syncEntitlementsToFlagRules("team_1", "plan_1", []);

    expect(db.flagRule.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: "plan", sourceId: "plan_1" }),
    }));
  });

  it("skips disabled entitlements", async () => {
    (db.catalogFeatureFlag.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flag_1" });
    (db.flagRule.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rule_1" });

    await syncEntitlementsToFlagRules("team_1", "plan_1", [
      { featureName: "Disabled Feature", featureKey: "disabled", type: "BOOLEAN", value: true, enabled: false },
    ]);

    expect(db.flagRule.create).not.toHaveBeenCalled();
  });
});
