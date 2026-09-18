import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db.js", () => ({
  db: {
    team: { findUnique: vi.fn() },
  },
}));

import {
  assertTierFeature,
  TIER_FEATURES,
} from "../../../src/lib/catalog/tier-guard.js";
import { db } from "../../../src/db.js";

const mockDb = db as any;

function stubTier(tier: string) {
  mockDb.team.findUnique.mockResolvedValue({ platformTier: tier });
}

describe("tier guard — invoice builder & branding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("locks the invoice builder for FREE tier and asks for Plus", async () => {
    stubTier("FREE");
    const gate = await assertTierFeature("team-1", "invoiceBuilder");
    expect(gate).toEqual({ allowed: false, upgradeRequired: "PLUS" });
  });

  it("unlocks the invoice builder on Plus", async () => {
    stubTier("PLUS");
    const gate = await assertTierFeature("team-1", "invoiceBuilder");
    expect(gate).toEqual({ allowed: true, upgradeRequired: "PLUS" });
  });

  it("unlocks the invoice builder on Pro", async () => {
    stubTier("PRO");
    const gate = await assertTierFeature("team-1", "invoiceBuilder");
    expect(gate).toEqual({ allowed: true, upgradeRequired: "PRO" });
  });

  it("keeps white-label branding (customBranding) locked on FREE", async () => {
    stubTier("FREE");
    const gate = await assertTierFeature("team-1", "customBranding");
    expect(gate).toEqual({ allowed: false, upgradeRequired: "PLUS" });
  });

  it("dedicated support is Pro-only while invoice builder stays Plus/Pro", async () => {
    stubTier("PLUS");
    const support = await assertTierFeature("team-1", "dedicatedSupport");
    expect(support.allowed).toBe(false);
    stubTier("PRO");
    const pro = await assertTierFeature("team-1", "dedicatedSupport");
    expect(pro.allowed).toBe(true);
  });

  it("TIER_FEATURES advertises invoice builder + branding on Plus/Pro only", () => {
    expect(TIER_FEATURES.FREE.invoiceBuilder).toBe(false);
    expect(TIER_FEATURES.PLUS.invoiceBuilder).toBe(true);
    expect(TIER_FEATURES.PRO.invoiceBuilder).toBe(true);
    expect(TIER_FEATURES.FREE.customBranding).toBe(false);
    expect(TIER_FEATURES.PLUS.customBranding).toBe(true);
    expect(TIER_FEATURES.PRO.customBranding).toBe(true);
  });
});
