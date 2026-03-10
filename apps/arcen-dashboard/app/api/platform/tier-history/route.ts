// ============================================================
//  Dashboard API — Tier Upgrade History
//
//  GET /api/platform/tier-history → List tier change history
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
    const auth = await requirePermission("audit:read");
    if (isErrorResponse(auth)) return auth;

    const limit = Math.min(
        parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10),
        100,
    );

    const history = await db.tierUpgradeHistory.findMany({
        where: { teamId: auth.team.teamId },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return NextResponse.json({ history });
}
