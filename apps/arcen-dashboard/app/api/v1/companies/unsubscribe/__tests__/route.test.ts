import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { db } from "@/lib/db";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";
import { verifyAutopayCancellationControl } from "@/lib/onchain-payment-verification";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  http: vi.fn(() => ({})),
  isAddress: vi.fn(() => true),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    ...viemMocks,
  };
});

vi.mock("@/lib/launch-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/launch-flags")>();
  return {
    ...actual,
    SELF_SERVE_CANCELLATION_ENABLED: true,
  };
});

vi.mock("@/lib/deliver-webhook", () => ({
  deliverWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/embed-access-token", () => ({
  extractEmbedAccessToken: vi.fn(() => "embed_token"),
  resolveEmbedAccessToken: vi.fn(),
}));

vi.mock("@/lib/catalog-billing", () => ({
  resolvePublishedFreePlan: vi.fn(),
}));

vi.mock("@/lib/billing-ledger", () => ({
  upsertSubscriptionLedgerState: vi.fn(() =>
    Promise.resolve({ id: "sub_state_1" }),
  ),
}));

vi.mock("@/lib/onchain-payment-verification", () => ({
  normalizeTxHash: vi.fn((value?: string | null) =>
    value && /^0x[0-9a-fA-F]{64}$/.test(value)
      ? (value as `0x${string}`)
      : null,
  ),
  verifyAutopayCancellationControl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arcenCompany: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    catalogPlan: { findFirst: vi.fn() },
  },
}));

const TEAM_ID = "team_1";
const COMPANY_ID = "company_1";
const CONTROL_TX = `0x${"d".repeat(64)}`;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/companies/unsubscribe", {
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
  (resolvePublishedFreePlan as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "plan_free",
    name: "Free",
  });
  (db.arcenCompany.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: COMPANY_ID,
    activePlanId: "plan_paid",
    traits: {
      subscriptionTransition: {
        mode: "period_end_downgrade",
        targetPlanId: "plan_other",
      },
    },
    walletAddress: "0x1111111111111111111111111111111111111111",
    subscriptionState: {
      walletAddress: "0x1111111111111111111111111111111111111111",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      onChainPlanId: "1",
      onChainTokenId: "42",
    },
  });
  (db.catalogPlan.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "plan_paid",
    name: "Paid",
    onChainPlanId: "1",
  });
  (verifyAutopayCancellationControl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    txHash: CONTROL_TX,
    paymentAccount: "0x1111111111111111111111111111111111111111",
    control: "PAUSED",
    controlledAt: "2026-04-25T00:00:00.000Z",
  });
  viemMocks.createPublicClient.mockReturnValue({
    readContract: vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true),
  });
}

describe("POST /api/v1/companies/unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_TOKEN_SECRET = "test_secret";
    setupBaseMocks();
  });

  it("schedules cancellation at period end by default and keeps current paid access", async () => {
    const res = await POST(
      makeRequest({
        autopayControlTxHash: CONTROL_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("cancel_at_period_end");
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ activePlanId: "plan_free" }),
      }),
    );
    expect(upsertSubscriptionLedgerState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        catalogPlanId: "plan_paid",
        cancelAtPeriodEnd: true,
        lastEvent: "subscription.cancel_scheduled",
      }),
    );
  });

  it("ignores the old immediate flag and still schedules period-end cancellation", async () => {
    const res = await POST(
      makeRequest({
        immediate: true,
        autopayControlTxHash: CONTROL_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("cancel_at_period_end");
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ activePlanId: "plan_free" }),
      }),
    );
    expect(upsertSubscriptionLedgerState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        catalogPlanId: "plan_paid",
        cancelAtPeriodEnd: true,
        lastEvent: "subscription.cancel_scheduled",
      }),
    );
  });

  it("returns a pending scheduled cancellation when autopay is already shut down but confirmations are still settling", async () => {
    (verifyAutopayCancellationControl as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 425,
      error:
        "Autopay cancellation-control transaction has 1 confirmation(s); 2 required before applying subscription changes.",
    });
    viemMocks.createPublicClient.mockReturnValueOnce({
      readContract: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const res = await POST(
      makeRequest({
        autopayControlTxHash: CONTROL_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json.data.mode).toBe("cancel_at_period_end");
    expect(json.data.pendingVerification).toBe(true);
    expect(upsertSubscriptionLedgerState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ACTIVE",
        cancelAtPeriodEnd: true,
        metadata: expect.objectContaining({
          pendingVerification: true,
        }),
      }),
    );
  });
});
