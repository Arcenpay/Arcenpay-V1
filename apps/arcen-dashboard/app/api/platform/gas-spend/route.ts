// ============================================================
//  Dashboard API — Gas Spend Recording
//
//  POST /api/platform/gas-spend → Record a sponsored gas spend
//
//  Called by the facilitator after a gas-sponsored transaction
//  is executed via the paymaster relay.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";

const spendSchema = z.object({
    teamId: z.string().min(1),
    chainId: z.number().int().positive(),
    txHash: z.string().min(1),
    gasUsed: z.number().positive(),
    gasCostUsd: z.number().nonnegative(),
    walletAddress: z.string().min(1),
    txType: z.string().optional(),
});

export async function POST(request: NextRequest) {
    const authError = requireFacilitatorAuth(request);
    if (authError) return authError;

    const body = await request.json().catch(() => ({}));
    const parsed = spendSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    const { teamId, chainId, txHash, gasUsed, gasCostUsd, walletAddress } = parsed.data;

    // Verify team exists
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { id: true },
    });
    if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const record = await db.gasSpend.create({
        data: {
            teamId,
            chainId,
            txHash,
            gasUsedWei: String(gasUsed),
            gasCostUsd,
            walletAddress,
        },
    });

    return NextResponse.json({ ok: true, id: record.id }, { status: 201 });
}
