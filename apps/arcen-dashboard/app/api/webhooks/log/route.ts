// ============================================================
//  Dashboard API — Webhook Delivery Log Proxy
//  Forwards requests to the facilitator's /api/webhooks/log
//  endpoint so the Settings page can display delivery history.
//  PRD §09 — Notifications & Webhooks
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";

const FACILITATOR_URL =
    process.env.FACILITATOR_BASE_URL ||
    process.env.FACILITATOR_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL ||
    "http://localhost:3402";

export async function GET(request: NextRequest) {
    // Require a valid session
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const limit = searchParams.get("limit") || "50";

        const response = await fetch(
            `${FACILITATOR_URL}/api/webhooks/log?limit=${limit}&provider=${session.address}`,
            {
                headers: {
                    "Content-Type": "application/json",
                    // Internal facilitator auth token
                    ...(process.env.FACILITATOR_SECRET
                        ? { Authorization: `Bearer ${process.env.FACILITATOR_SECRET}` }
                        : {}),
                },
                next: { revalidate: 0 },
            },
        );

        if (!response.ok) {
            // Facilitator not available — return empty list gracefully
            if (response.status === 404 || response.status === 503) {
                return NextResponse.json({ entries: [] });
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
        });
    } catch (err) {
        console.error("[api/webhooks/log]", err);
        // Return empty list — don't break Settings page if facilitator is down
        return NextResponse.json({ entries: [] });
    }
}
