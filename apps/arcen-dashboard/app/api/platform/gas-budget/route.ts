// ============================================================
//  Dashboard API — Gas Budget Info & History
//
//  GET  /api/platform/gas-budget  → Current gas budget + 7-day history
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { getDailyGasSpend, getGasSpendHistory } from "@/lib/gas-policy";

export async function GET(request: NextRequest) {
    const auth = await requirePermission("catalog:read");
    if (isErrorResponse(auth)) return auth;

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 7, 1), 30) : 7;

    const [budget, history] = await Promise.all([
        getDailyGasSpend(auth.team.teamId),
        getGasSpendHistory(auth.team.teamId, days),
    ]);

    return NextResponse.json({
        budget,
        history,
    });
}
