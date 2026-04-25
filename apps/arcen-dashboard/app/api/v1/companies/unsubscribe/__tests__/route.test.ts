import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { db } from "@/lib/db";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";
import {
  verifyAutopayCancellationControl,
  verifySubscriptionCancellation,
} from "@/lib/onchain-payment-verification";

vi.mock("@/lib/launch-flags", () => ({
  SELF_SERVE_CANCELLATION_ENABLED: true,
}));

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
  verifySubscriptionCancellation: vi.fn(),
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
const CANCEL_TX = `0x${"e".repeat(64)}`;

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
  (verifySubscriptionCancellation as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    txHash: CANCEL_TX,
    tokenId: "42",
    onChainPlanId: "1",
    cancelledAt: "2026-04-25T00:00:00.000Z",
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
    expect(verifySubscriptionCancellation).not.toHaveBeenCalled();
  });

  it("requires explicit immediate cancellation before moving to the free plan immediately", async () => {
    const res = await POST(
      makeRequest({
        immediate: true,
        cancellationTxHash: CANCEL_TX,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("cancelled_on_chain");
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activePlanId: "plan_free" }),
      }),
    );
    expect(upsertSubscriptionLedgerState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CANCELLED",
        catalogPlanId: "plan_free",
        cancelAtPeriodEnd: false,
        lastEvent: "subscription.cancelled",
      }),
    );
    expect(verifyAutopayCancellationControl).not.toHaveBeenCalled();
  });
});
