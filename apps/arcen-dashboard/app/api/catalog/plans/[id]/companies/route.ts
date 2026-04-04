import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const teamId = auth.team.teamId;

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId },
    select: { id: true, name: true },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const search = request.nextUrl.searchParams.get("search")?.trim();

  const companies = await db.arcenCompany.findMany({
    where: {
      teamId,
      activePlanId: id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { walletAddress: { contains: search, mode: "insensitive" } },
              { externalId: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      email: true,
      walletAddress: true,
      externalId: true,
      activePlanId: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  return NextResponse.json({
    data: companies,
    count: companies.length,
    plan,
  });
}
