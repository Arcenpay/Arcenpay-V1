import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeMeteredEntitlement,
  ConsumeEntitlementError,
} from "./usage-consume";
import { resolveCompany, resolveUser } from "./flag-engine";
import { resolveEntitlementResult } from "./entitlements";
import { touchEntityActivity } from "./activity";
import { invalidateUsageCache } from "./event-aggregator";
import { invalidateFlagCache } from "./flag-cache";
import { db } from "./db";

type TransactionMock = Pick<typeof db, "arcenEvent">;

vi.mock("./flag-engine", () => ({
  resolveCompany: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("./entitlements", () => ({
  resolveEntitlementResult: vi.fn(),
}));

vi.mock("./activity", () => ({
  touchEntityActivity: vi.fn(),
}));

vi.mock("./event-aggregator", () => ({
  invalidateUsageCache: vi.fn(),
}));

vi.mock("./flag-cache", () => ({
  invalidateFlagCache: vi.fn(),
}));

vi.mock("./db", () => ({
  db: {
    catalogFeatureFlag: {
      findFirst: vi.fn(),
    },
    arcenEvent: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockResolveCompany = vi.mocked(resolveCompany);
const mockResolveUser = vi.mocked(resolveUser);
const mockResolveEntitlementResult = vi.mocked(resolveEntitlementResult);
const mockTouchEntityActivity = vi.mocked(touchEntityActivity);
const mockInvalidateUsageCache = vi.mocked(invalidateUsageCache);
const mockInvalidateFlagCache = vi.mocked(invalidateFlagCache);

describe("consumeMeteredEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveCompany.mockResolvedValue({
      id: "company_1",
      traits: {},
      activePlanId: "plan_1",
      activeAddOnIds: [],
    });
    mockResolveUser.mockResolvedValue({
      id: "user_1",
      companyId: "company_1",
      traits: {},
    });
    (db.catalogFeatureFlag.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventKey: "scan",
      featureType: "event_based",
    });
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: (tx: TransactionMock) => Promise<unknown>) => callback(db),
    );
  });

  it("denies consumption when the allocation is already exhausted", async () => {
    mockResolveEntitlementResult
      .mockResolvedValueOnce({
        key: "scan",
        enabled: true,
        reason: "Rule 101 matched",
        allocation: 15,
        usage: 14,
        exceeded: false,
      })
      .mockResolvedValueOnce({
        key: "scan",
        enabled: false,
        reason: "Rule 101 matched · limit reached",
        allocation: 15,
        usage: 15,
        exceeded: true,
      });
    (db.arcenEvent.count as ReturnType<typeof vi.fn>).mockResolvedValue(15);

    const result = await consumeMeteredEntitlement({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      userKeys: { internalId: "user_1" },
      featureKey: "scan",
    });

    expect(result.consumed).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.exceeded).toBe(true);
    expect(db.arcenEvent.create).not.toHaveBeenCalled();
    expect(mockTouchEntityActivity).toHaveBeenCalledWith("company_1", "user_1");
    expect(mockInvalidateUsageCache).toHaveBeenCalled();
    expect(mockInvalidateFlagCache).toHaveBeenCalled();
  });

  it("treats an existing idempotency key as already consumed", async () => {
    mockResolveEntitlementResult
      .mockResolvedValueOnce({
        key: "scan",
        enabled: true,
        reason: "Rule 101 matched",
        allocation: 15,
        usage: 10,
        exceeded: false,
      })
      .mockResolvedValueOnce({
        key: "scan",
        enabled: true,
        reason: "Rule 101 matched",
        allocation: 15,
        usage: 10,
        exceeded: false,
      });
    (db.arcenEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "evt_1",
        traits: {
          __arcen: {
            idempotencyKey: "scan-1",
          },
        },
      },
    ]);

    const result = await consumeMeteredEntitlement({
      teamId: "team_1",
      companyKeys: { internalId: "company_1" },
      userKeys: { internalId: "user_1" },
      featureKey: "scan",
      idempotencyKey: "scan-1",
    });

    expect(result.consumed).toBe(true);
    expect(db.arcenEvent.create).not.toHaveBeenCalled();
  });

  it("rejects non-metered features", async () => {
    (db.catalogFeatureFlag.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventKey: null,
      featureType: "boolean",
    });
    mockResolveEntitlementResult.mockResolvedValue({
      key: "export_pdf",
      enabled: true,
      reason: "Rule 1 matched",
      allocation: null,
      usage: 0,
      exceeded: false,
    });

    await expect(
      consumeMeteredEntitlement({
        teamId: "team_1",
        companyKeys: { internalId: "company_1" },
        featureKey: "export_pdf",
      }),
    ).rejects.toBeInstanceOf(ConsumeEntitlementError);
  });
});
