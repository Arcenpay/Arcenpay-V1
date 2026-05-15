import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  db: {
    subscriptionState: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscriptionChangeRequest: {
      update: vi.fn(),
    },
    arcenCompany: {
      update: vi.fn(),
    },
    catalogPlan: {
      findFirst: vi.fn(),
    },
    catalogConfig: {
      findUnique: vi.fn(),
    },
    billingAdjustment: {
      create: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
    teamMember: {
      findFirst: vi.fn(),
    },
    billingRecoveryTask: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    paymentAttempt: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    billingEvent: {
      findMany: vi.fn(),
    },
    checkoutSession: {
      findMany: vi.fn(),
    },
    subscriberEmail: {
      upsert: vi.fn(),
    },
    billingBalance: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../webhooks/deliver-webhook.js", () => ({
  deliverWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock("./billing-reconciliation.js", () => ({
  getBillingReconciliationSummary: vi.fn(() =>
    Promise.resolve({
      active: 0,
      pastDue: 0,
      cancelled: 0,
      total: 0,
    }),
  ),
}));

vi.mock("./billing-dunning.js", () => ({
  runBillingDunningSweep: vi.fn(() =>
    Promise.resolve({
      scanned: 0,
      enforced: 0,
      skipped: 0,
      results: [],
    }),
  ),
}));

vi.mock("./billing-recovery.js", () => ({
  processPendingBillingRecoveryTasks: vi.fn(() =>
    Promise.resolve({
      scanned: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: [],
    }),
  ),
}));

vi.mock("./billing-adjustments.js", () => ({
  recordBillingAdjustment: vi.fn(() =>
    Promise.resolve({
      id: "adjustment-test-id",
      kind: "DOWNGRADE_PRORATION_CREDIT",
    }),
  ),
}));

vi.mock("./subscription-change-requests.js", () => ({
  getLatestSubscriptionChangeRequest: vi.fn(),
}));

vi.mock("../catalog/catalog-billing.js", () => ({
  resolvePublishedFreePlan: vi.fn(() =>
    Promise.resolve({
      id: "free-plan-id",
      name: "Free",
    }),
  ),
  normalizeBillingPeriod: vi.fn(
    (value?: string | null) => {
      if (value === "annual" || value === "yearly") return "annual";
      return "monthly";
    },
  ),
}));

import { db } from "../../db.js";
import { applyScheduledSubscriptionTransitions } from "./billing-maintenance.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { recordBillingAdjustment } from "./billing-adjustments.js";
import { getLatestSubscriptionChangeRequest } from "./subscription-change-requests.js";

const mockDb = db as any;

function makeDbSubscriptionState(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "state-1",
    companyId: overrides.companyId ?? "company-1",
    walletAddress: overrides.walletAddress ?? "0x123",
    currentPeriodStart: overrides.currentPeriodStart ?? new Date("2026-01-01"),
    currentPeriodEnd: overrides.currentPeriodEnd ?? new Date("2026-01-31"),
    onChainTokenId: overrides.onChainTokenId ?? null,
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    company: {
      id: overrides.companyId ?? "company-1",
      activePlanId: (overrides as any).companyActivePlanId ?? "plan-pro",
      traits: (overrides as any).companyTraits ?? {},
    },
  } as any;
}

function makePlan(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: overrides.name ?? `Plan ${id}`,
    onChainPlanId: overrides.onChainPlanId ?? null,
    billingInterval: overrides.billingInterval ?? 2_592_000,
    price: (overrides as any).price ?? "29.99",
    annualPrice: (overrides as any).annualPrice ?? null,
  };
}

describe("applyScheduledSubscriptionTransitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue(null);
  });

  it("skips when no states have due transitions at period end", async () => {
    mockDb.subscriptionState.findMany.mockResolvedValue([]);

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
    });

    expect(result.scanned).toBe(0);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("skips a state that has no open subscription change request", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      companyTraits: {},
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-02-01"),
    });

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0].action).toBe("skipped");
    expect(result.results[0].reason).toBe("no_due_transition");
  });

  it("applies a scheduled cancel_at_period_end transition", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      cancelAtPeriodEnd: true,
      companyActivePlanId: "plan-paid",
      companyTraits: {},
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-cancel-1",
      companyId: "company-1",
      changeType: "cancellation",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-paid",
      targetPlanId: null,
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "monthly",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-15").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "cancel_at_period_end" },
      mode: "cancel_at_period_end",
      targetPlanName: null,
    } as any);
    const freePlan = makePlan("free-plan-id", { name: "Free", price: "0" });
    mockDb.catalogPlan.findFirst.mockImplementation((args: any) => {
      const id = args?.where?.id;
      if (id === "free-plan-id") return Promise.resolve(freePlan);
      if (id === "plan-paid") return Promise.resolve(makePlan("plan-paid", { name: "Paid", price: "19.99" }));
      return Promise.resolve(null);
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue({ id: "state-1" });

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-02-01"),
    });

    expect(result.applied).toBe(1);
    expect(result.results[0].action).toBe("cancel_applied");
    expect(result.results[0].targetPlanId).toBe("free-plan-id");

    expect(mockDb.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company-1" },
        data: expect.objectContaining({
          activePlanId: "free-plan-id",
        }),
      }),
    );

    expect(mockDb.subscriptionState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "state-1" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelAtPeriodEnd: false,
        }),
      }),
    );

    expect(vi.mocked(deliverWebhook)).toHaveBeenCalledWith(
      "team-1",
      "company.plan.cancelled",
      expect.objectContaining({
        mode: "cancellation_completed",
        companyId: "company-1",
      }),
    );
  });

  it("applies a period_end_downgrade transition", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      companyActivePlanId: "plan-pro",
      companyTraits: {
        billingPeriod: "monthly",
      },
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-downgrade-1",
      companyId: "company-1",
      changeType: "downgrade",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-pro",
      targetPlanId: "plan-starter",
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "monthly",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-15").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "period_end_downgrade" },
      mode: "period_end_downgrade",
      targetPlanName: "Starter",
    } as any);

    const targetPlan = makePlan("plan-starter", {
      name: "Starter",
      price: "9.99",
    });
    const previousPlan = makePlan("plan-pro", {
      name: "Pro",
      price: "29.99",
    });

    mockDb.catalogPlan.findFirst.mockImplementation((args: any) => {
      const id = args?.where?.id;
      if (id === "plan-starter") return Promise.resolve(targetPlan);
      if (id === "plan-pro") return Promise.resolve(previousPlan);
      return Promise.resolve(null);
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue({ id: "state-1" });

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-01-15"),
    });

    expect(result.applied).toBe(1);
    expect(result.results[0].action).toBe("downgrade_applied");
    expect(result.results[0].targetPlanId).toBe("plan-starter");

    expect(mockDb.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activePlanId: "plan-starter",
        }),
      }),
    );
  });

  it("records proration credit for downgrade when period has remaining time", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-31"),
      companyActivePlanId: "plan-pro",
      companyTraits: {
        billingPeriod: "monthly",
      },
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-downgrade-credit-1",
      companyId: "company-1",
      changeType: "downgrade",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-pro",
      targetPlanId: "plan-starter",
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "monthly",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-31").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "period_end_downgrade" },
      mode: "period_end_downgrade",
      targetPlanName: "Starter",
    } as any);

    const targetPlan = makePlan("plan-starter", { name: "Starter", price: "9.99" });
    const previousPlan = makePlan("plan-pro", { name: "Pro", price: "29.99" });

    mockDb.catalogPlan.findFirst.mockImplementation((args: any) => {
      const id = args?.where?.id;
      if (id === "plan-starter") return Promise.resolve(targetPlan);
      if (id === "plan-pro") return Promise.resolve(previousPlan);
      return Promise.resolve(null);
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue({ id: "state-1" });

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-01-15"),
    });

    expect(result.applied).toBe(1);

    expect(vi.mocked(recordBillingAdjustment)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "DOWNGRADE_PRORATION_CREDIT",
        companyId: "company-1",
        fromCatalogPlanId: "plan-pro",
        toCatalogPlanId: "plan-starter",
      }),
    );
  });

  it("handles next_renewal_on_chain stale transitions by clearing them", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      companyActivePlanId: "plan-pro",
      cancelAtPeriodEnd: false,
      companyTraits: {},
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-renewal-1",
      companyId: "company-1",
      changeType: "billing_period_change",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-pro",
      targetPlanId: "plan-starter",
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "annual",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-15").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "next_renewal_on_chain" },
      mode: "next_renewal_on_chain",
      targetPlanName: "Starter",
    } as any);

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-02-01"),
    });

    expect(result.staleNextRenewal).toBe(1);
    expect(result.results[0].action).toBe("stale_next_renewal");
    expect(result.results[0].reason).toContain("on_chain_renewal_not_detected");

    expect(mockDb.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company-1" },
        data: expect.objectContaining({
          traits: expect.any(Object),
        }),
      }),
    );
  });

  it("skips when the target plan is not published", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      companyActivePlanId: "plan-paid",
      companyTraits: {},
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-downgrade-missing-1",
      companyId: "company-1",
      changeType: "downgrade",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-paid",
      targetPlanId: "archived-plan",
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "monthly",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-15").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "period_end_downgrade" },
      mode: "period_end_downgrade",
      targetPlanName: null,
    } as any);
    mockDb.catalogPlan.findFirst.mockResolvedValue(null);

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-02-01"),
    });

    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toBe("target_plan_not_available");
  });

  it("uses free plan fallback for cancel_at_period_end without targetPlanId", async () => {
    const state = makeDbSubscriptionState({
      currentPeriodEnd: new Date("2026-01-15"),
      cancelAtPeriodEnd: true,
      companyActivePlanId: "plan-paid",
      companyTraits: {},
    });
    mockDb.subscriptionState.findMany.mockResolvedValue([state]);
    vi.mocked(getLatestSubscriptionChangeRequest).mockResolvedValue({
      id: "req-cancel-fallback-1",
      companyId: "company-1",
      changeType: "cancellation",
      stage: "requested",
      source: "self_service",
      previousPlanId: "plan-paid",
      targetPlanId: null,
      previousBillingPeriod: "monthly",
      targetBillingPeriod: "monthly",
      requestedAt: new Date("2026-01-01").toISOString(),
      effectiveAt: new Date("2026-01-15").toISOString(),
      appliedAt: null,
      failedAt: null,
      autopayConfigTxHash: null,
      accessChangeTxHash: null,
      paymentTxHash: null,
      autopayControlTxHash: null,
      recoveryTaskId: null,
      pendingVerification: false,
      pendingRecovery: false,
      failureReason: null,
      metadata: { mode: "cancel_at_period_end" },
      mode: "cancel_at_period_end",
      targetPlanName: null,
    } as any);
    const freePlan = makePlan("free-plan-id", { name: "Free", price: "0" });
    mockDb.catalogPlan.findFirst.mockImplementation((args: any) => {
      const id = args?.where?.id;
      if (id === "free-plan-id") return Promise.resolve(freePlan);
      if (id === "plan-paid") return Promise.resolve(makePlan("plan-paid", { name: "Paid", price: "19.99" }));
      return Promise.resolve(null);
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue({ id: "state-1" });

    const result = await applyScheduledSubscriptionTransitions({
      teamId: "team-1",
      now: new Date("2026-02-01"),
    });

    expect(result.applied).toBe(1);
    expect(result.results[0].targetPlanId).toBe("free-plan-id");
  });
});
