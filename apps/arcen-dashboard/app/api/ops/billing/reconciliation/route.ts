// ============================================================
//  Dashboard — Ops: Billing Reconciliation Snapshot
//  GET /api/ops/billing/reconciliation
//
//  Access: OWNER or ADMIN role only.
//  Returns a point-in-time summary of ledger/invoice/subscription mismatches.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { getBillingReconciliationSummary } from "@/lib/billing-reconciliation";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  const team = await resolveTeamContext(session);
  if (!team) return null;
  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") return null;
  return { session, team };
}

export async function GET(_request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const summary = await getBillingReconciliationSummary({
    teamId: auth.team.teamId,
  });

  return NextResponse.json(summary);
}
