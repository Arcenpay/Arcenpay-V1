/**
 * GET /api/internal/agent/configs — Returns all agent configs for the facilitator
 *
 * Used by the facilitator to read auto-topup/dispatch configurations
 * and monitor agent balances. Requires FACILITATOR_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FACILITATOR_SECRET } from "@/lib/config";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (FACILITATOR_SECRET && auth !== `Bearer ${FACILITATOR_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await db.arcenAgentConfig.findMany({
    select: {
      teamId: true,
      autoTopUp: true,
      dispatch: true,
      agentWalletAddress: true,
    },
  });

  return NextResponse.json({
    configs: configs.map((c) => ({
      teamId: c.teamId,
      autoTopUp: c.autoTopUp,
      dispatch: c.dispatch,
      agentWalletAddress: c.agentWalletAddress,
    })),
  });
}
