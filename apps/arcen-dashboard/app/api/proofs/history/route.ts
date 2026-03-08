import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") || "12");
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(Math.trunc(rawLimit), 200))
      : 12;

    const upstream = await fetch(
      `${FACILITATOR_URL}/api/proofs/history?limit=${limit}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {}),
        },
        cache: "no-store",
      },
    );

    if (!upstream.ok) {
      return NextResponse.json({ count: 0, jobs: [] });
    }

    const payload = await upstream.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return NextResponse.json({
      count: Number(payload.count) || jobs.length,
      jobs,
    });
  } catch (err) {
    console.error("[api/proofs/history]", err);
    return NextResponse.json({ count: 0, jobs: [] });
  }
}
