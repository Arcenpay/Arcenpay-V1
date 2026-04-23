import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "../route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";

vi.mock("@/lib/db", () => ({
  db: {
    arcenCompany: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    catalogPlan: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/catalog-billing", () => ({
  resolvePublishedFreePlan: vi.fn(),
}));

vi.mock("@/lib/billing-ledger", () => ({
  upsertSubscriptionLedgerState: vi.fn(),
}));

const FACILITATOR_SECRET = "test-secret";
process.env.FACILITATOR_SECRET = FACILITATOR_SECRET;
const TEAM_ID = "team_1";

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/internal/companies/sync-subscription",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FACILITATOR_SECRET}`,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("PATCH /api/internal/companies/sync-subscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FACILITATOR_SECRET = FACILITATOR_SECRET;
    (upsertSubscriptionLedgerState as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
  });

  it("returns 401 without correct secret", async () => {
    const req = new NextRequest(
      "http://localhost/api/internal/companies/sync-subscription",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer wrong" },
        body: JSON.stringify({
          teamId: TEAM_ID,
          wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          onChainPlanId: "1",
          event: "minted",
        }),
      },
    );
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("sets activePlanId on minted event", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {},
      activePlanId: null,
    });
    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "plan_1",
    });
    (db.arcenCompany.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "42",
        event: "minted",
      }),
    );

    expect(res.status).toBe(200);
    expect(db.arcenCompany.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teamId: TEAM_ID,
          walletAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        },
      }),
    );
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activePlanId: "plan_1" }),
      }),
    );
  });

  it("falls back to the configured free plan on cancelled event", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {},
      activePlanId: "plan_old",
    });
    (resolvePublishedFreePlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "plan_fallback",
    });
    (db.arcenCompany.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: null,
        event: "cancelled",
      }),
    );

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activePlanId: "plan_fallback" }),
      }),
    );
  });

  it("returns 409 when a cancelled event has no configured free plan", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {},
      activePlanId: "plan_old",
    });
    (resolvePublishedFreePlan as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: null,
        event: "cancelled",
      }),
    );

    expect(res.status).toBe(409);
    expect(db.arcenCompany.update).not.toHaveBeenCalled();
  });

  it("sets activePlanId on renewed event", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {},
      activePlanId: null,
    });
    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "plan_1",
    });
    (db.arcenCompany.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "42",
        event: "renewed",
      }),
    );

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activePlanId: "plan_1" }),
      }),
    );
  });

  it("returns 404 if company not found", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "1",
        event: "minted",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("skips stale events for the same company", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {
        subscriptionSyncMeta: {
          occurredAt: "2026-04-20T12:00:00.000Z",
          sourceTxHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          event: "minted",
        },
      },
      activePlanId: "plan_current",
    });

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "42",
        event: "renewed",
        occurredAt: "2026-04-20T11:59:59.000Z",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "stale_event",
      activePlanId: "plan_current",
    });
    expect(db.arcenCompany.update).not.toHaveBeenCalled();
  });

  it("skips duplicate tx hashes for the same event", async () => {
    const txHash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
      teamId: TEAM_ID,
      traits: {
        subscriptionSyncMeta: {
          occurredAt: "2026-04-20T12:00:00.000Z",
          sourceTxHash: txHash,
          event: "renewed",
        },
      },
      activePlanId: "plan_current",
    });

    const res = await PATCH(
      makeRequest({
        teamId: TEAM_ID,
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "42",
        event: "renewed",
        sourceTxHash: txHash,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "duplicate_event",
      activePlanId: "plan_current",
    });
    expect(db.arcenCompany.update).not.toHaveBeenCalled();
  });

  it("requires explicit team scoping", async () => {
    const res = await PATCH(
      makeRequest({
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onChainPlanId: "42",
        event: "minted",
      }),
    );

    expect(res.status).toBe(400);
  });
});
