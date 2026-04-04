import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "../route";
import { GET as getCanonicalCheck } from "@/app/api/v1/check/route";

vi.mock("@/app/api/v1/check/route", () => ({
  GET: vi.fn(),
}));

const mockGetCanonicalCheck = vi.mocked(getCanonicalCheck);

describe("GET /api/v1/flags/check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("preserves the compatibility envelope for successful responses", async () => {
    mockGetCanonicalCheck.mockResolvedValue(
      NextResponse.json({
        key: "analytics",
        enabled: true,
        reason: "Plan entitlement",
        allocation: null,
        usage: 0,
        exceeded: false,
      }),
    );

    const req = new NextRequest("http://localhost/api/v1/flags/check?key=analytics");
    const res = await GET(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      data: {
        flag: "analytics",
        value: true,
        reason: "Plan entitlement",
      },
      key: "analytics",
      enabled: true,
      reason: "Plan entitlement",
      allocation: null,
      usage: 0,
      exceeded: false,
    });
  });

  it("passes through canonical errors unchanged", async () => {
    mockGetCanonicalCheck.mockResolvedValue(
      NextResponse.json({ error: "Authorization required" }, { status: 401 }),
    );

    const req = new NextRequest("http://localhost/api/v1/flags/check?key=analytics");
    const res = await GET(req);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "Authorization required",
    });
  });
});
