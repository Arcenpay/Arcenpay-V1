import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "../route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

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

const FACILITATOR_SECRET = "test-secret";
process.env.FACILITATOR_SECRET = FACILITATOR_SECRET;

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
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without correct secret", async () => {
    const req = new NextRequest(
      "http://localhost/api/internal/companies/sync-subscription",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer wrong" },
        body: JSON.stringify({
          wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          onChainPlanId: "1",
          event: "minted",
        }),
      },
    );
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("sets activePlanId on minted event", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
    });
    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "plan_1",
    });
    (db.arcenCompany.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", onChainPlanId: "42", event: "minted" }),
    );

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activePlanId: "plan_1" },
      }),
    );
  });

  it("clears activePlanId on cancelled event", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "co_1",
    });
    (db.arcenCompany.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", onChainPlanId: null, event: "cancelled" }),
    );

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activePlanId: null },
      }),
    );
  });

  it("returns 404 if company not found", async () => {
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await PATCH(
      makeRequest({ wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", onChainPlanId: "1", event: "minted" }),
    );
    expect(res.status).toBe(404);
  });
});
