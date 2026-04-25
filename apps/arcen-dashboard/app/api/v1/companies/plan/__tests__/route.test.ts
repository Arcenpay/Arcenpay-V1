import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { db } from "@/lib/db";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { resolvePlanAmountMicros } from "@/lib/catalog-billing";
import {
  verifyAutopayPlanChange,
  verifyDirectErc20Transfer,
  verifySubscriptionRegistryPlanChange,
} from "@/lib/onchain-payment-verification";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";

vi.mock("@/lib/launch-flags", () => ({
  SELF_SERVE_PLAN_CHANGES_ENABLED: true,
}));

vi.mock("@/lib/deliver-webhook", () => ({
  deliverWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/entitlements", () => ({
  resolveEntitlementResults: vi.fn(() =>
    Promise.resolve({ entitlements: [] }),
  ),
}));

vi.mock("@/lib/embed-access-token", () => ({
  extractEmbedAccessToken: vi.fn(() => "embed_token"),
  resolveEmbedAccessToken: vi.fn(),
}));

vi.mock("@/lib/catalog-billing", () => ({
  incrementCouponRedemption: vi.fn(),
  normalizeBillingPeriod: vi.fn(() => "monthly"),
  normalizeCouponCode: vi.fn(() => null),
  resolveCouponQuote: vi.fn(() =>
    Promise.resolve({
      ok: true,
      quote: {
        finalAmountMicros: 30_000_000,
        finalAmount: 30,
      },
    }),
  ),
  resolvePlanAmountMicros: vi.fn((plan: { id: string }) =>
    plan.id === "plan_current" ? 10_000_000 : 30_000_000,
  ),
}));

vi.mock("@/lib/billing-ledger", () => ({
  recordSuccessfulPayment: vi.fn(() => Promise.resolve({ id: "pay_1" })),
  upsertSubscriptionLedgerState: vi.fn(() =>
    Promise.resolve({ id: "sub_state_1" }),
  ),
}));

vi.mock("@/lib/billing-adjustments", () => ({
  recordBillingAdjustment: vi.fn(() => Promise.resolve({ id: "adj_1" })),
}));

vi.mock("@/lib/onchain-payment-verification", () => ({
  normalizeTxHash: vi.fn((value?: string | null) =>
    value && /^0x[0-9a-fA-F]{64}$/.test(value)
      ? (value as `0x${string}`)
      : null,
  ),
  verifyAutopayPlanChange: vi.fn(),
  verifyDirectErc20Transfer: vi.fn(),
  verifySubscriptionRegistryPlanChange: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    catalogPlan: { findFirst: vi.fn() },
    catalogConfig: { findFirst: vi.fn() },
    arcenCompany: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscriberEmail: { upsert: vi.fn() },
    team: { findUnique: vi.fn() },
    invoice: { create: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const TEAM_ID = "team_1";
const COMPANY_ID = "company_1";
const AUTOPAY_TX = `0x${"a".repeat(64)}`;
const PAYMENT_TX = `0x${"b".repeat(64)}`;
const ACCESS_TX = `0x${"c".repeat(64)}`;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/companies/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer embed_token",
    },
    body: JSON.stringify(body),
  });
}

function setupBaseMocks() {
  (resolveEmbedAccessToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    teamId: TEAM_ID,
    companyId: COMPANY_ID,
    userId: null,
  });
  (db.catalogPlan.findFirst as unknown as ReturnType<typeof vi.fn>).mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === "plan_target") {
      return Promise.resolve({
        id: "plan_target",
        name: "Pro",
        price: 30,
        annualPrice: null,
        acceptedToken: "0x0000000000000000000000000000000000000002",
        onChainPlanId: "2",
        metadata: {},
      });
    }

    if (where.id === "plan_current") {
      return Promise.resolve({
        id: "plan_current",
        name: "Starter",
        price: 10,
        annualPrice: null,
        onChainPlanId: "1",
      });
    }

    return Promise.resolve(null);
  });
  (db.catalogConfig.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    downgradeImmediately: false,
    preventDowngradeOverLimit: false,
    disallowSelfServiceDowngrade: false,
  });
  (db.arcenCompany.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: COMPANY_ID,
    activePlanId: "plan_current",
    traits: {},
    walletAddress: "0x1111111111111111111111111111111111111111",
    email: "buyer@example.com",
    subscriptionState: {
      id: "sub_state_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      onChainTokenId: "42",
    },
  });
  (verifyAutopayPlanChange as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    txHash: AUTOPAY_TX,
    tokenId: "42",
    previousOnChainPlanId: "1",
    onChainPlanId: "2",
    acceptedToken: "0x0000000000000000000000000000000000000002",
    merchantWallet: "0x2222222222222222222222222222222222222222",
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
  });
  (verifyDirectErc20Transfer as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    txHash: PAYMENT_TX,
    senderWallet: "0x1111111111111111111111111111111111111111",
    recipientWallet: "0x2222222222222222222222222222222222222222",
    amountAtomic: 10_000_000n,
  });
  (verifySubscriptionRegistryPlanChange as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    txHash: ACCESS_TX,
    tokenId: "42",
    previousOnChainPlanId: "1",
    onChainPlanId: "2",
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
    billerWallet: "0x3333333333333333333333333333333333333333",
  });
}

describe("POST /api/v1/companies/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_TOKEN_SECRET = "test_secret";
    setupBaseMocks();
  });

  it("rejects immediate on-chain upgrades without an authorized access-change transaction", async () => {
    const res = await POST(
      makeRequest({
        planId: "plan_target",
        autopayConfigTxHash: AUTOPAY_TX,
        paymentTxHash: PAYMENT_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("SubscriptionRegistry.changePlan");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reused autopay transaction hashes before verifying payment", async () => {
    (db.arcenCompany.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: COMPANY_ID,
      activePlanId: "plan_current",
      traits: { billingVerifiedTxHashes: [AUTOPAY_TX] },
      walletAddress: "0x1111111111111111111111111111111111111111",
      email: "buyer@example.com",
      subscriptionState: {
        id: "sub_state_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        onChainTokenId: "42",
      },
    });

    const res = await POST(
      makeRequest({
        planId: "plan_target",
        autopayConfigTxHash: AUTOPAY_TX,
        paymentTxHash: PAYMENT_TX,
        accessChangeTxHash: ACCESS_TX,
      }),
    );

    expect(res.status).toBe(409);
    expect(verifyAutopayPlanChange).not.toHaveBeenCalled();
    expect(verifyDirectErc20Transfer).not.toHaveBeenCalled();
  });

  it("schedules a downgrade instead of changing access immediately", async () => {
    (resolvePlanAmountMicros as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (plan: { id: string }) =>
        plan.id === "plan_current" ? 30_000_000 : 5_000_000,
    );
    (db.catalogPlan.findFirst as unknown as ReturnType<typeof vi.fn>).mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === "plan_target") {
        return Promise.resolve({
          id: "plan_target",
          name: "Basic",
          price: 5,
          annualPrice: null,
          acceptedToken: "0x0000000000000000000000000000000000000002",
          onChainPlanId: "2",
          metadata: {},
        });
      }

      if (where.id === "plan_current") {
        return Promise.resolve({
          id: "plan_current",
          name: "Pro",
          price: 30,
          annualPrice: null,
          onChainPlanId: "1",
        });
      }

      return Promise.resolve(null);
    });

    const res = await POST(
      makeRequest({
        planId: "plan_target",
        autopayConfigTxHash: AUTOPAY_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("next_renewal_on_chain");
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activePlanId: "plan_current" }),
      }),
    );
    expect(upsertSubscriptionLedgerState).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogPlanId: "plan_current",
        lastEvent: "subscription.plan_change_pending",
      }),
    );
  });
});
