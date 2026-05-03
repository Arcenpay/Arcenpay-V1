import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${FACILITATOR_URL}/api/proofs/active`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json({
        count: 0,
        jobs: [],
        degraded: true,
        message: `Facilitator returned ${upstream.status}.`,
      });
    }

    const payload = await upstream.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return NextResponse.json({
      count: Number(payload.count) || jobs.length,
      jobs,
      degraded: false,
    });
  } catch (err) {
    console.error("[api/proofs/active]", err);
    return NextResponse.json({
      count: 0,
      jobs: [],
      degraded: true,
      message: err instanceof Error ? err.message : "Active proof jobs unavailable.",
    });
  }
}
