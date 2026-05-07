import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "../route";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

vi.mock("@/lib/api-auth", () => ({
  requirePermission: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    catalogFeatureFlag: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("PUT /api/v1/features/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      team: { teamId: "team_1" },
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(isErrorResponse).mockReturnValue(false);
    vi.mocked(db.catalogFeatureFlag.findFirst).mockResolvedValue({
      id: "flag_1",
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
    } as never);
  });

  it("updates editable feature fields while preserving the feature key", async () => {
    vi.mocked(db.catalogFeatureFlag.update).mockResolvedValue({
      id: "flag_1",
      name: "Scan API",
      featureKey: "scan",
      featureType: "event_based",
      eventKey: "scan",
      description: "Updated description",
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
    } as never);

    const response = await PUT(
      new NextRequest("http://localhost/api/v1/features/flag_1", {
        method: "PUT",
        body: JSON.stringify({
          name: "Scan API",
          description: "Updated description",
          featureType: "event",
          eventKey: "scan",
        }),
      }),
      { params: Promise.resolve({ id: "flag_1" }) },
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(db.catalogFeatureFlag.update).toHaveBeenCalledWith({
      where: { id: "flag_1" },
      data: expect.objectContaining({
        name: "Scan API",
        description: "Updated description",
        featureType: "event_based",
        eventKey: "scan",
      }),
      select: expect.any(Object),
    });
    expect(json.feature).toEqual(
      expect.objectContaining({
        id: "flag_1",
        featureKey: "scan",
        featureType: "event",
      }),
    );
  });
});
