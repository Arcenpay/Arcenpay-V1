import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";

vi.mock("@/lib/require-any-auth", () => ({
  requireAnyAuth: vi.fn(),
  isAnyAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    arcenUser: {
      findMany: vi.fn(),
    },
  },
}));

describe("GET /api/v1/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyAuth).mockResolvedValue({
      teamId: "team_1",
      source: "api_key",
    } as Awaited<ReturnType<typeof requireAnyAuth>>);
    vi.mocked(isAnyAuthError).mockReturnValue(false);
  });

  it("returns users with their linked company summary", async () => {
    vi.mocked(db.arcenUser.findMany).mockResolvedValue([
      {
        id: "user_1",
        name: "Jane",
        email: "jane@acme.com",
        walletAddress: null,
        clerkUserId: null,
        externalId: null,
        companyId: "company_1",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-05-06T00:00:00.000Z"),
        company: {
          id: "company_1",
          name: "Acme",
          email: "team@acme.com",
          walletAddress: "0x1111111111111111111111111111111111111111",
        },
      },
    ] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/v1/users?search=acme"),
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(db.arcenUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { company: { name: { contains: "acme", mode: "insensitive" } } },
          ]),
        }),
        select: expect.objectContaining({
          company: {
            select: {
              id: true,
              name: true,
              email: true,
              walletAddress: true,
            },
          },
        }),
      }),
    );
    expect(json.data[0]).toEqual(
      expect.objectContaining({
        id: "user_1",
        company: expect.objectContaining({
          id: "company_1",
          name: "Acme",
        }),
      }),
    );
  });
});
