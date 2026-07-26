import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db.js", () => ({
  db: {
    platformBillingAccount: { findUnique: vi.fn() },
    platformBillingCustomer: { findUnique: vi.fn(), create: vi.fn() },
    team: { findUnique: vi.fn(), update: vi.fn() },
    arcenCompany: { findFirst: vi.fn(), create: vi.fn() },
    subscriptionState: { findUnique: vi.fn() },
    catalogPlan: { findUnique: vi.fn() },
  },
}));

import { db } from "../../../src/db.js";
import {
  ensurePlatformBillingCustomer,
  projectPlatformBillingEntitlement,
} from "../../../src/lib/billing/platform-billing-customer.js";

const mockDb = db as any;

describe("platform billing customer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one stable first-party customer for a workspace", async () => {
    mockDb.platformBillingAccount.findUnique.mockResolvedValue({
      providerTeamId: "platform-team",
      environmentId: "platform-production",
      portalComponentId: "portal-1",
    });
    mockDb.platformBillingCustomer.findUnique.mockResolvedValue(null);
    mockDb.team.findUnique.mockResolvedValue({ id: "workspace-1", name: "Acme" });
    mockDb.arcenCompany.findFirst.mockResolvedValue(null);
    mockDb.arcenCompany.create.mockResolvedValue({ id: "company-1" });
    mockDb.platformBillingCustomer.create.mockResolvedValue({ id: "mapping-1" });

    const result = await ensurePlatformBillingCustomer({ workspaceTeamId: "workspace-1" });

    expect(result).toEqual({
      configured: true,
      created: true,
      providerTeamId: "platform-team",
      environmentId: "platform-production",
      portalComponentId: "portal-1",
      companyId: "company-1",
    });
    expect(mockDb.arcenCompany.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: "platform-team",
        environmentId: "platform-production",
        externalId: "workspace:workspace-1",
        name: "Acme",
      }),
      select: { id: true },
    });
  });

  it("returns the existing customer without creating a duplicate", async () => {
    mockDb.platformBillingAccount.findUnique.mockResolvedValue({
      providerTeamId: "platform-team",
      environmentId: "platform-production",
      portalComponentId: null,
    });
    mockDb.platformBillingCustomer.findUnique.mockResolvedValue({ companyId: "company-1" });

    const result = await ensurePlatformBillingCustomer({ workspaceTeamId: "workspace-1" });

    expect(result.created).toBe(false);
    expect(result.companyId).toBe("company-1");
    expect(mockDb.arcenCompany.create).not.toHaveBeenCalled();
  });

  it("reports a concurrent mapping as deduped", async () => {
    mockDb.platformBillingAccount.findUnique.mockResolvedValue({
      providerTeamId: "platform-team",
      environmentId: "platform-production",
      portalComponentId: null,
    });
    mockDb.platformBillingCustomer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ companyId: "company-1" });
    mockDb.team.findUnique.mockResolvedValue({ id: "workspace-1", name: "Acme" });
    mockDb.arcenCompany.findFirst.mockResolvedValue({ id: "company-1" });
    mockDb.platformBillingCustomer.create.mockRejectedValue({ code: "P2002" });

    const result = await ensurePlatformBillingCustomer({ workspaceTeamId: "workspace-1" });

    expect(result.created).toBe(false);
    expect(result.companyId).toBe("company-1");
  });

  it("projects an active platform subscription into the workspace tier", async () => {
    mockDb.platformBillingCustomer.findUnique.mockResolvedValue({
      workspaceTeamId: "workspace-1",
      providerTeamId: "platform-team",
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue({
      id: "subscription-1",
      status: "ACTIVE",
      catalogPlanId: "plan-pro",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    });
    mockDb.catalogPlan.findUnique.mockResolvedValue({ metadata: { platformTier: "PRO" } });
    mockDb.team.findUnique.mockResolvedValue({
      platformTier: "FREE",
      tierSubscriptionId: null,
      tierExpiresAt: null,
    });

    const result = await projectPlatformBillingEntitlement({
      providerTeamId: "platform-team",
      companyId: "company-1",
    });

    expect(result).toEqual({ projected: true, tier: "PRO", workspaceTeamId: "workspace-1" });
    expect(mockDb.team.update).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      data: {
        platformTier: "PRO",
        tierSubscriptionId: "subscription-1",
        tierExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
  });
});
