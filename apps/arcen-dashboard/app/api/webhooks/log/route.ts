// ============================================================
//  Dashboard API — Webhook Delivery Log Proxy
//  Forwards requests to the facilitator's /api/webhooks/log
//  endpoint so the Settings page can display delivery history.
//  PRD §09 — Notifications & Webhooks
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  if (team) {
    const limitParam = Number(
      request.nextUrl.searchParams.get("limit") || "50",
    );
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(Math.trunc(limitParam), 200))
      : 50;

    const entries = await db.webhookDelivery.findMany({
      where: { teamId: team.teamId },
      orderBy: { deliveredAt: "desc" },
      take: limit,
    });

    if (entries.length > 0) {
      return NextResponse.json({
        configured: true,
        entries,
        log: entries,
        source: "database",
        degraded: false,
      });
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "50";

    const response = await fetch(
      `${FACILITATOR_URL}/api/webhooks/log?limit=${limit}&provider=${team?.walletAddress ?? ""}`,
      {
        headers: {
          "Content-Type": "application/json",
          // Internal facilitator auth token
          ...(FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {}),
        },
        next: { revalidate: 0 },
      },
    );

    if (!response.ok) {
      // Facilitator not available — return empty list gracefully
      if (response.status === 404 || response.status === 503) {
        return NextResponse.json({
          entries: [],
          degraded: true,
          message: "Webhook delivery log backend is temporarily unavailable.",
          source: "facilitator",
        });
      }
      throw new Error(`Facilitator returned ${response.status}`);
    }

    const data = await response.json();
    const entries = Array.isArray(data.entries)
      ? data.entries
      : Array.isArray(data.log)
        ? data.log
        : [];

    return NextResponse.json({
      configured: data.configured !== false,
      entries,
      // deprecated alias retained for compatibility with legacy clients
      log: entries,
      degraded: data.degraded === true,
      message:
        typeof data.message === "string" ? data.message : undefined,
      source: "facilitator",
    });
  } catch (err) {
    console.error("[api/webhooks/log]", err);
    // Return empty list — don't break Settings page if facilitator is down
    return NextResponse.json({
      entries: [],
      degraded: true,
      message: err instanceof Error ? err.message : "Webhook log unavailable.",
      source: "facilitator",
    });
  }
}
