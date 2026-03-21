/**
 * GET /api/events — Fetch recent events for the demo company
 */
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const baseUrl = process.env.ARCEN_BASE_URL || "http://localhost:3000";
    const apiKey = process.env.ARCEN_API_KEY;
    if (!apiKey) throw new Error("ARCEN_API_KEY not set");

    const limit = req.nextUrl.searchParams.get("limit") || "20";
    const res = await fetch(`${baseUrl}/api/v1/events?limit=${limit}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const data = await res.json() as unknown;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
