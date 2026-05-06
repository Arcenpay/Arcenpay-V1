import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCompany } from "..\/flag-engine";
import { db } from "@/lib/db";
import { getContractAddresses } from "@arcenpay/sdk";
import { createPublicClient } from "viem";

const mocks = vi.hoisted(() => ({
  arcenCompanyFindFirst: vi.fn(),
  arcenCompanyUpdate: vi.fn(),
  catalogPlanFindFirst: vi.fn(),
  readContract: vi.fn(),
  createPublicClient: vi.fn(),
  getContractAddresses: vi.fn(),
  getRpcUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arcenCompany: {
      findFirst: mocks.arcenCompanyFindFirst,
      update: mocks.arcenCompanyUpdate,
    },
    catalogPlan: {
      findFirst: mocks.catalogPlanFindFirst,
    },
  },
}));

vi.mock("@/lib/config", () => ({
  getRpcUrl: mocks.getRpcUrl,
}));

vi.mock("@/lib/default-chain", () => ({
  DEFAULT_CHAIN_ID: 84532,
}));

vi.mock("@/lib/event-aggregator", () => ({
  aggregateUsage: vi.fn(),
}));

vi.mock("@/lib/flag-cache", () => ({
  getCachedFlag: vi.fn(),
  setCachedFlag: vi.fn(),
}));

vi.mock("@arcenpay/sdk", () => ({
  getContractAddresses: mocks.getContractAddresses,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    http: vi.fn((url: string) => ({ url })),
  };
});

describe("resolveCompany subscription access window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.arcenCompanyUpdate.mockResolvedValue({});
    mocks.createPublicClient.mockReturnValue({
      readContract: mocks.readContract,
    });
    mocks.getRpcUrl.mockReturnValue("https://rpc.example");
    mocks.getContractAddresses.mockReturnValue({
      subscriptionRegistry: "0x0000000000000000000000000000000000000001",
    });
  });

  it("does not grant plan access for an expired active subscription", async () => {
    mocks.arcenCompanyFindFirst.mockResolvedValue({
      id: "company_1",
      traits: {},
      activePlanId: "cached_paid_plan",
      activeAddOnIds: [],
      subscriptionState: {
        status: "ACTIVE",
        catalogPlanId: "paid_plan",
        currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
        graceEndsAt: null,
      },
    });

    const result = await resolveCompany("team_1", {
      internalId: "company_1",
      wallet: "0x1111111111111111111111111111111111111111",
    });

    expect(result?.activePlanId).toBeNull();
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("keeps access for cancel-at-period-end subscriptions until the period ends", async () => {
    mocks.arcenCompanyFindFirst.mockResolvedValue({
      id: "company_1",
      traits: {
        subscriptionTransition: { mode: "cancel_at_period_end" },
      },
      activePlanId: "paid_plan",
      activeAddOnIds: [],
      subscriptionState: {
        status: "ACTIVE",
        catalogPlanId: "paid_plan",
        currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
        graceEndsAt: null,
      },
    });

    const result = await resolveCompany("team_1", {
      internalId: "company_1",
    });

    expect(result?.activePlanId).toBe("paid_plan");
  });

  it("does not grant paid access for past_due subscriptions without active grace", async () => {
    mocks.arcenCompanyFindFirst.mockResolvedValue({
      id: "company_1",
      traits: {},
      activePlanId: "cached_paid_plan",
      activeAddOnIds: [],
      subscriptionState: {
        status: "PAST_DUE",
        catalogPlanId: "paid_plan",
        currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
        graceEndsAt: null,
      },
    });

    const result = await resolveCompany("team_1", {
      internalId: "company_1",
    });

    expect(result?.activePlanId).toBeNull();
  });

  it("does not repair plan access from an expired on-chain subscription token", async () => {
    mocks.arcenCompanyFindFirst.mockResolvedValue({
      id: "company_1",
      traits: {},
      activePlanId: null,
      activeAddOnIds: [],
      subscriptionState: null,
    });
    mocks.readContract.mockImplementation(({ functionName }) => {
      if (functionName === "getWalletSubscription") return Promise.resolve(123n);
      if (functionName === "hasActiveSubscription") return Promise.resolve(false);
      throw new Error(`Unexpected read: ${String(functionName)}`);
    });

    const result = await resolveCompany("team_1", {
      internalId: "company_1",
      wallet: "0x1111111111111111111111111111111111111111",
    });

    expect(result?.activePlanId).toBeNull();
    expect(getContractAddresses).toHaveBeenCalledWith(84532);
    expect(db.catalogPlan.findFirst).not.toHaveBeenCalled();
  });
});
