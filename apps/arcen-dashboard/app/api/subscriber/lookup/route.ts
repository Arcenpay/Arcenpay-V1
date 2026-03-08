// ============================================================
//  Dashboard API — Subscriber Email Lookup
//  GET /api/subscriber/lookup?wallet=0x...
//
//  Internal endpoint — called by the facilitator node to resolve
//  a subscriber's email address before sending notifications.
//  Protected via a shared secret (Authorization: Bearer <FACILITATOR_SECRET>).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FACILITATOR_SECRET } from "@/lib/config";

export async function GET(req: NextRequest) {
  // Auth check — require the shared secret header
  if (FACILITATOR_SECRET) {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (token !== FACILITATOR_SECRET) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const wallet = req.nextUrl.searchParams.get("wallet");

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  }

  const record = await db.subscriberEmail
    .findUnique({
      where: { walletAddress: wallet },
      select: { email: true, planId: true },
    })
    .catch(() => null);

  if (!record) {
    return NextResponse.json({ email: null }, { status: 200 });
  }

  return NextResponse.json({ email: record.email, planId: record.planId });
}
