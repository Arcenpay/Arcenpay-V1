import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db.js", () => ({
  db: {
    arcenCompany: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    subscriptionState: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../../src/lib/billing/invoices.js", () => ({
  toSix: (amount: number) => amount.toFixed(6),
}));

vi.mock("../../../src/lib/billing/billing-balances.js", () => ({
  applyInvoicePayment: vi.fn(),
}));

import { db } from "../../../src/db.js";
import { upsertSubscriptionLedgerState } from "../../../src/lib/billing/billing-ledger.js";

const mockDb = db as any;

describe("billing ledger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a company by on-chain token when wallet lookup is unavailable", async () => {
    mockDb.arcenCompany.findFirst.mockResolvedValueOnce(null);
    mockDb.subscriptionState.findUnique.mockResolvedValueOnce(null);
    mockDb.subscriptionState.findFirst.mockResolvedValueOnce({
      company: {
        id: "company-1",
        teamId: "team-1",
        environmentId: "env-1",
        walletAddress: null,
        activePlanId: "plan-free",
      },
    });
    mockDb.subscriptionState.upsert.mockResolvedValue({ id: "subscription-1" });
    mockDb.arcenCompany.update.mockResolvedValue({ id: "company-1" });

    await upsertSubscriptionLedgerState({
      teamId: "team-1",
      onChainTokenId: "token-101",
      status: "ACTIVE",
      catalogPlanId: "plan-pro",
    });

    expect(mockDb.subscriptionState.findFirst).toHaveBeenCalledWith({
      where: { teamId: "team-1", onChainTokenId: "token-101" },
      select: {
        company: {
          select: {
            id: true,
            teamId: true,
            environmentId: true,
            walletAddress: true,
            activePlanId: true,
          },
        },
      },
    });
    expect(mockDb.subscriptionState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1" },
        update: expect.objectContaining({
          onChainTokenId: "token-101",
          catalogPlanId: "plan-pro",
        }),
        create: expect.objectContaining({
          companyId: "company-1",
          onChainTokenId: "token-101",
          catalogPlanId: "plan-pro",
        }),
      }),
    );
    expect(mockDb.arcenCompany.update).toHaveBeenCalledWith({
      where: { id: "company-1" },
      data: { activePlanId: "plan-pro" },
    });
  });

  it("threads a Stellar chainId into the ledger upsert as chainFamily STELLAR", async () => {
    // Reset each mock fully before arming, so stale once-queues from the prior
    // test cannot shadow the new return values.
    mockDb.arcenCompany.findFirst.mockReset();
    mockDb.subscriptionState.findUnique.mockReset();
    mockDb.subscriptionState.upsert.mockReset();

    mockDb.arcenCompany.findFirst.mockResolvedValue({
      id: "company-1",
      teamId: "team-1",
      environmentId: "env-1",
      walletAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      activePlanId: "plan-free",
    });
    mockDb.subscriptionState.findUnique.mockResolvedValue(null);
    mockDb.subscriptionState.upsert.mockResolvedValue({
      id: "subscription-1",
    });
    mockDb.payment.findUnique.mockResolvedValue(null);
    mockDb.payment.create.mockResolvedValue({ id: "payment-1" });
    mockDb.payment.update.mockResolvedValue({ id: "payment-1" });

    await upsertSubscriptionLedgerState({
      teamId: "team-1",
      companyId: "company-1",
      walletAddress:
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      chainId: 9_000_001,
      status: "ACTIVE",
      catalogPlanId: "plan-pro",
    });

    expect(mockDb.subscriptionState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1" },
        update: expect.objectContaining({
          chainId: 9_000_001,
          chainFamily: "STELLAR",
          // Stellar wallet preserved with original case (base32 is
          // case-sensitive — never lowercased).
          walletAddress:
            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        }),
        create: expect.objectContaining({
          chainId: 9_000_001,
          chainFamily: "STELLAR",
        }),
      }),
    );
  });
});
